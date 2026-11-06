import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../plugin/canvas_reader.cjs', import.meta.url), 'utf8');
function harness(config = { RENDER_MODE: 'canvas' }) {
  const callbacks = new Map(), timers = new Map();
  const content = { style: { visibility: 'visible', overflow: 'auto', position: '' }, scrollTop: 345 };
  const state = { destroyed: 0, invalidated: 0, focused: 0, opened: 0, errors: [], markdown: '# Unsaved changes', path: 'C:\\notes\\test.md' };
  const focus = { isConnected: true, focus: () => state.focused++ };
  const sandbox = { module: { exports: {} }, console: { ...console, error() {}, info() {} }, document: { activeElement: focus },
    getComputedStyle: () => ({ position: 'static' }),
    setTimeout: callback => { const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: callback => { state.poll = callback; return 1; }, clearInterval() {},
    File: { editor: { sourceView: { inSourceMode: false } } },
    BasePlugin: class {}, require: name => {
      assert.equal(name, './canvas_reader/runtime.cjs');
      const mount = options => {
        if (state.failMount) throw new Error('Canvas unavailable');
        state.received = options; state.opened++;
        return { destroy: () => state.destroyed++, invalidate: () => state.invalidated++ };
      };
      return { mountReader: mount, mountHybrid: mount };
    } };
  vm.runInNewContext(code, sandbox);
  const plugin = new sandbox.module.exports.plugin();
  plugin.config = config;
  const names = ['beforeFileOpen', 'beforeToggleSourceMode', 'fileEdited', 'fileContentLoaded', 'allPluginsHadInjected'];
  plugin.utils = { getCurrentFileContent: () => state.markdown, getFilePath: () => state.path,
    entities: { eContent: content, eWrite: {} }, eventHub: {
      eventType: Object.fromEntries(names.map(n => [n, n])),
      on: (name, callback) => callbacks.set(name, callback)
    }, showMessageBox: options => state.errors.push(options) };
  plugin.process();
  return { plugin, content, state, sandbox, emit: name => callbacks.get(name)(),
    tick: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}

test('manual toggle mounts in the original pane and restores host styles, focus and scroll', () => {
  const h = harness(); h.plugin.call();
  assert.equal(h.state.received.markdown, '# Unsaved changes');
  assert.equal(h.state.received.title, 'test.md');
  assert.equal(h.state.received.parent, h.content);
  assert.equal(h.state.received.embedded, true);
  assert.equal(h.content.style.visibility, 'hidden');
  assert.equal(h.content.scrollTop, 0);
  h.state.received.onClose();
  assert.deepEqual(h.content.style, { visibility: 'visible', overflow: 'auto', position: '' });
  assert.equal(h.content.scrollTop, 345);
  assert.equal(h.state.destroyed, 1); assert.equal(h.state.focused, 1);
  h.plugin.close(); assert.equal(h.state.destroyed, 1);
});

test('auto-opens on startup and after navigation, but Esc keeps the same file editable', () => {
  const h = harness();
  h.emit('allPluginsHadInjected'); h.emit('fileContentLoaded'); h.tick();
  assert.equal(h.state.opened, 1);
  h.state.received.onClose(); h.emit('fileContentLoaded'); h.tick();
  assert.equal(h.state.opened, 1);
  h.emit('fileEdited'); h.emit('fileContentLoaded'); h.tick();
  assert.equal(h.state.opened, 1);
  h.emit('beforeFileOpen'); h.state.path = 'C:\\notes\\second.md'; h.state.markdown = '# Second';
  h.emit('fileContentLoaded'); h.tick();
  assert.equal(h.state.opened, 2);
  assert.equal(h.state.received.markdown, '# Second');
  const focused = h.state.focused;
  h.emit('beforeFileOpen');
  assert.equal(h.content.style.visibility, 'visible');
  assert.equal(h.state.focused, focused, 'navigation must not restore focus to the previous document');
});

test('pending auto-open is cancelled by navigation, but initial render mutations do not disable it', () => {
  const h = harness();
  h.emit('allPluginsHadInjected'); h.emit('beforeFileOpen'); h.tick();
  assert.equal(h.state.opened, 0);
  h.emit('fileContentLoaded'); h.emit('fileEdited'); h.tick();
  assert.equal(h.state.opened, 1);
});

test('auto mode respects opt-out, source mode and empty new files', () => {
  for (const kind of ['disabled', 'source', 'empty']) {
    const h = harness(kind === 'disabled' ? { AUTO_OPEN: false, RENDER_MODE: 'canvas' } : { RENDER_MODE: 'canvas' });
    if (kind === 'source') h.sandbox.File.editor.sourceView.inSourceMode = true;
    if (kind === 'empty') h.state.markdown = ' \n';
    h.emit('allPluginsHadInjected'); h.tick();
    assert.equal(h.state.opened, 0, kind);
    assert.equal(h.content.scrollTop, 345);
  }
});

test('hybrid is the default, starts without lifecycle events, and never hides the editable pane', () => {
  const h = harness({}); h.state.markdown = ''; h.tick();
  assert.equal(h.state.opened, 1);
  assert.equal(h.state.received.write, h.plugin.utils.entities.eWrite);
  assert.equal(h.state.received.content, h.content);
  assert.equal(h.content.style.visibility, 'visible');
  assert.equal(h.content.scrollTop, 345);
  h.emit('fileEdited'); assert.equal(h.state.invalidated, 1);
  assert.equal(h.state.destroyed, 0);
  h.emit('fileContentLoaded'); h.tick(); assert.equal(h.state.opened, 1);
  h.plugin.dispose(); assert.equal(h.state.destroyed, 1);
});

test('source-mode teardown resumes after returning to native rendered mode', () => {
  const h = harness({}); h.tick();
  h.sandbox.File.editor.sourceView.inSourceMode = true; h.state.poll(); h.tick();
  assert.equal(h.state.destroyed, 1);
  assert.equal(h.state.opened, 1);
  h.sandbox.File.editor.sourceView.inSourceMode = false; h.state.poll(); h.tick();
  assert.equal(h.state.opened, 2);
});

test('failed canvas startup restores the original pane and does not auto-loop', () => {
  const h = harness(); h.state.failMount = true;
  h.emit('allPluginsHadInjected'); h.tick();
  assert.equal(h.state.errors.length, 1);
  assert.equal(h.content.style.visibility, 'visible');
  assert.equal(h.content.style.overflow, 'auto');
  assert.equal(h.content.scrollTop, 345);
  h.emit('fileContentLoaded'); h.tick();
  assert.equal(h.state.errors.length, 1);
});
