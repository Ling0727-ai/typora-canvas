import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('Typora adapter reads an unsaved snapshot, restores host visibility, and closes on file switch', async () => {
  const code = await readFile(new URL('../plugin/canvas_reader.cjs', import.meta.url), 'utf8');
  const callbacks = new Map();
  const content = { style: { visibility: 'visible' } };
  let destroyed = 0, focused = 0, received;
  const focus = { isConnected: true, focus: () => focused++ };
  const sandbox = { module: { exports: {} }, console, document: { activeElement: focus },
    BasePlugin: class {}, require: name => {
      assert.equal(name, './canvas_reader/runtime.cjs');
      return { mountReader: options => { received = options; return { destroy: () => destroyed++ }; } };
    } };
  vm.runInNewContext(code, sandbox);
  const plugin = new sandbox.module.exports.plugin();
  plugin.config = {};
  plugin.utils = { getCurrentFileContent: () => '# Unsaved changes', getFilePath: () => 'C:\\notes\\test.md',
    entities: { eContent: content }, eventHub: {
      eventType: { beforeFileOpen: 'beforeFileOpen', beforeToggleSourceMode: 'beforeToggleSourceMode', fileEdited: 'fileEdited' },
      on: (name, callback) => callbacks.set(name, callback)
    } };
  plugin.process(); plugin.call();
  assert.equal(received.markdown, '# Unsaved changes');
  assert.equal(received.title, 'test.md');
  assert.equal(content.style.visibility, 'hidden');
  callbacks.get('beforeFileOpen')();
  assert.equal(content.style.visibility, 'visible');
  assert.equal(destroyed, 1); assert.equal(focused, 1);
  plugin.close(); assert.equal(destroyed, 1);
  plugin.call(); received.onClose();
  assert.equal(content.style.visibility, 'visible');
  assert.equal(destroyed, 2);
});
