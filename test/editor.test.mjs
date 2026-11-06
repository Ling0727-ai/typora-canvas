import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, inputDiff, classifyLines, tableCells } from '../src/editor-model.js';
import { sourceRuns, layoutSourceLine, hitSource, caretSource } from '../src/editor-layout.js';
import { attachCanvasHost } from '../src/host-bridge.js';
import { formulaSvg } from '../src/formula.js';
import { readFileSync } from 'node:fs';

test('the fatigue derivation groups all multiline formulas and retains literal source on failure', () => {
  const source = readFileSync(new URL('./fixtures/fatigue-math.md', import.meta.url), 'utf8');
  const doc = new CanvasDocument(source).doc, rows = classifyLines(doc);
  const blocks = rows.filter(r => r.type === 'math');
  assert.equal(blocks.length, 3);
  assert.ok(blocks[0].tex.endsWith('=-\\varphi_\\sigma'));
  assert.ok(blocks[2].tex.endsWith('1+\\varphi_\\sigma}}'));
  for (let i = 0; i < rows.length; i++) {
    if (!['math', 'math-tail'].includes(rows[i].type)) continue;
    const text = doc.line(i + 1).text;
    const result = layoutSourceLine({ font: '' }, text, rows[i], { width: 300, raw: true,
      asset: () => ({ status: 'error' }), measure: (_, value) => value.length * 10 });
    assert.equal(result.lines.flatMap(l => l.pieces).map(p => p.text).join(''), text);
    assert.ok(result.lines.every(l => l.pieces.every(p => p.x + p.width <= 300)));
  }
});

test('rope edits preserve unknown Markdown and existing CRLF byte-for-byte', () => {
  const source = '---\r\nx: 1\r\n---\r\n\r\n> [!note]\r\n中文😀 **bold**\r\n$$x^2$$\r\n';
  const model = new CanvasDocument(source);
  assert.equal(model.getText(), source);
  model.select(source.indexOf('中文'));
  model.replaceSelection('新增');
  assert.equal(model.getText(), source.replace('中文', '新增中文'));
  assert.equal(model.dirty, true);
  model.undo(); assert.equal(model.getText(), source); assert.equal(model.dirty, false);
  model.redo(); assert.equal(model.getText(), source.replace('中文', '新增中文'));
});

test('one IME composition forms one undo group and restores its selection', () => {
  const model = new CanvasDocument('abc'); model.select(1);
  model.beginGroup(); model.replaceSelection('中'); model.replace(1, 2, '中文'); model.endGroup();
  assert.equal(model.getText(), 'a中文bc');
  model.undo(); assert.equal(model.getText(), 'abc'); assert.equal(model.head, 1);
  model.redo(); assert.equal(model.getText(), 'a中文bc');
});

test('input diffs reconstruct inserts, deletions, and replacement over Unicode', () => {
  for (const [before, after] of [['中文😀', '中文😀x'], ['abc', 'ab'], ['old\nline', 'new\n行']]) {
    const d = inputDiff(before, after);
    assert.equal(before.slice(0, d.from) + d.text + before.slice(d.to), after);
  }
});

test('formula grouping ignores code fences and source hit testing skips hidden markers', () => {
  const model = new CanvasDocument('```tex\n$$\n```\n$$\nx^2\n$$\n# Heading');
  const rows = classifyLines(model.doc);
  assert.equal(rows[1].type, 'code'); assert.equal(rows[3].type, 'math');
  assert.equal(rows[3].tex, 'x^2'); assert.equal(rows[4].start, 3);
  const runs = sourceRuns('# Heading', rows[6], false); assert.equal(runs[0].from, 2);
  const ctx = { font: '', measureText: text => ({ width: text.length * 10 }) };
  const line = layoutSourceLine(ctx, '# Heading', rows[6], { width: 100, raw: false,
    asset: () => null, measure: (_, text) => text.length * 10 });
  assert.equal(hitSource(line, 0, 20, 9), 2);
});

test('MathJax produces self-contained SVG paths, rather than DOM screenshots', () => {
  const result = formulaSvg('\\frac{1}{2}+\\int_0^1 x^2\\,dx');
  assert.ok(result.svg.includes('<path'));
  assert.ok(!result.svg.includes('<foreignObject'));
  assert.ok(result.width > 20 && result.height > 20);
  assert.ok(result.depth >= 0); assert.ok(result.ascent > 0);
  assert.ok(Math.abs(result.ascent + result.depth - result.height) < .001);
});

test('inline formula ascent/depth share the text baseline and display math is centered', () => {
  const media = { image: {}, width: 30, height: 40, ascent: 28, depth: 12 };
  const options = { width: 300, raw: false, asset: () => media, measure: (_, text) => text.length * 10 };
  const layout = layoutSourceLine({ font: '' }, 'a $x$ b', { type: 'paragraph' }, options);
  const visual = layout.lines[0], formula = visual.pieces.find(p => p.media);
  assert.equal(visual.baseline, 28); assert.equal(visual.height, 40);
  assert.equal(visual.top + visual.baseline - formula.ascent + formula.ascent, visual.top + visual.baseline);
  const block = layoutSourceLine({ font: '' }, '$$x$$', { type: 'math', tex: 'x' }, options);
  assert.equal(block.mediaX, 135);
});

test('inline alpha previews after the closing delimiter and expands only inside the formula', () => {
  const source = '$\\alpha$';
  assert.equal(sourceRuns(source, { type: 'paragraph' }, true, source.length)[0].tex, '\\alpha');
  assert.equal(sourceRuns(source, { type: 'paragraph' }, true, 3)[0].tex, undefined);
  const ctx = { font: '' };
  const value = layoutSourceLine(ctx, source, { type: 'paragraph' }, { width: 300, raw: true, cursor: source.length,
    asset: () => ({ image: {}, width: 12, height: 17 }), measure: (_, text) => text.length * 10 });
  assert.equal(value.lines[0].pieces[0].from, 0); assert.equal(value.lines[0].pieces[0].to, source.length);
  assert.equal(hitSource(value, 1, 10, source.length), 1);
  assert.equal(hitSource(value, 11, 10, source.length), source.length - 1);
  assert.equal(caretSource(value, source.length).x, 12);
  const pending = layoutSourceLine(ctx, source, { type: 'paragraph' }, { width: 300, raw: false,
    asset: () => null, measure: (_, text) => text.length * 10 });
  assert.equal(pending.lines[0].pieces.map(p => p.text).join(''), source);
});

test('tables retain source ranges, ignore escaped/code pipes and provide cell-aware hit testing', () => {
  assert.deepEqual(tableCells('| a\\|b | `x|y` |').map(c => c.text), ['a\\|b', '`x|y`']);
  const model = new CanvasDocument('| 项目 | 公式 |\n| --- | :---: |\n| 应力 | $\\alpha$ |');
  const rows = classifyLines(model.doc);
  assert.equal(rows[0].type, 'table'); assert.equal(rows[1].type, 'table-separator');
  assert.equal(rows[2].columns, 2); assert.equal(rows[2].alignments[1], 'center');
  const text = model.doc.line(3).text;
  const layout = layoutSourceLine({ font: '' }, text, rows[2], { width: 300, raw: false,
    asset: () => ({ image: {}, width: 12, height: 17 }), measure: (_, value) => value.length * 10 });
  assert.equal(layout.cells.length, 2);
  assert.ok(hitSource(layout, 200, 15, text.length) >= tableCells(text)[1].from);
  assert.ok(caretSource(layout, tableCells(text)[1].to).x > 150);
});

test('host saves the current source without native layout per edit, restores hooks on exit', async () => {
  let source = '# Original', changes = 0, reloads = 0, saved = '', recovered = '';
  const originalSync = () => '# Native', originalMarkdown = () => '# Native';
  const file = { editor: { getMarkdown: originalMarkdown }, sync: originalSync,
    ChangeType: { NSChangeDone: 7 }, updateChangeCount: value => { assert.equal(value, 7); changes++; },
    reloadContent: value => { reloads++; source = value; },
    saveUseNode: async () => { saved = file.sync(true, false, true); return true; } };
  const bridge = attachCanvasHost({ file, editor: { getText: () => source }, onRecovery: value => { recovered = value; } });
  source = '# Edited\n\n> [!custom]\n$$x^2$$'; bridge.changed();
  assert.equal(reloads, 0); assert.equal(changes, 1);
  assert.equal(file.editor.getMarkdown(), source);
  await bridge.save(); assert.equal(saved, source);
  bridge.detach(); assert.equal(reloads, 1); assert.equal(recovered, source);
  assert.equal(file.sync, originalSync); assert.equal(file.editor.getMarkdown, originalMarkdown);
  bridge.detach(); assert.equal(reloads, 1);
});

test('external document changes block saving and preserve a separate recovery source', async () => {
  let native = 'original', source = 'original', saved = false, recovered = '', reloads = 0;
  const file = { editor: { getMarkdown: () => native }, sync: () => native,
    reloadContent: () => reloads++, saveUseNode: async () => { saved = true; } };
  const bridge = attachCanvasHost({ file, editor: { getText: () => source }, onRecovery: text => { recovered = text; } });
  source = 'Canvas edits'; native = 'External edits';
  assert.equal(bridge.checkExternal(), true);
  await assert.rejects(bridge.save(), /外部文档/);
  bridge.detach(); assert.equal(recovered, 'Canvas edits'); assert.equal(saved, false); assert.equal(reloads, 0);
});
