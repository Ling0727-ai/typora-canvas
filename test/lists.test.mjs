import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { layoutSourceLine, caretSource, hitSource } from '../src/editor-layout.js';
import { listMarker } from '../src/lists.js';
const classify = source => classifyLines(new CanvasDocument(source).doc);
const options = { width: 140, raw: false, size: 18, asset: () => ({ image: {}, width: 12, height: 17 }),
  measure: (_, text) => [...text].length * 10 };
const draw = (source, row, opts = {}) => layoutSourceLine({ font: '' }, source, row, { ...options, ...opts });

test('bullet variants and ordered lists use actual block scopes, starts, and sibling counters', () => {
  const source = '- One\n- Two\n\n+ Three\n+ Four\n\n7. Seven\n1. Eight\n1. Nine\n\nText\n\n3) Three\n4) Four';
  const rows = classify(source);
  assert.equal(listMarker(rows[0].list), '•');
  assert.deepEqual([6, 7, 8, 12, 13].map(i => rows[i].list.number), [7, 8, 9, 3, 4]);
  assert.equal(rows[10].list, undefined);
  assert.equal(classify('---\n\n* * *\n\n2026. words')[0].list, undefined);
  assert.equal(classify('text\n2. not a paragraph-interrupting list')[1].list, undefined);
});

test('nested mixed lists and continuation lines retain UTF-16 source ranges', () => {
  const source = '- Outer\n  1. Inner **bold** $x$\n     continuation\n  1. Next\n- Last';
  const rows = classify(source);
  assert.deepEqual(rows.map(r => r.list.depth), [0, 1, 1, 1, 0]);
  assert.deepEqual(rows.map(r => r.list.number), [1, 1, 1, 2, 2]);
  assert.equal(rows[2].list.first, false);
  assert.equal(rows[2].list.contentFrom, 5);
  for (const i of [0, 1, 2, 3, 4]) {
    const text = source.split('\n')[i], layout = draw(text, rows[i]);
    const content = layout.lines.flatMap(l => l.pieces).filter(p => !p.listMarker);
    assert.equal(content[0].from, rows[i].list.contentFrom);
    assert.ok(content.every(p => p.tex || text.slice(p.from, p.to) === p.text));
    assert.equal(hitSource(layout, content[0].x, layout.lines[0].top, text.length), content[0].from);
  }
});

test('wrapped list lines have hanging indentation, theme markers, and exact raw editing', () => {
  const source = '9. Long item text that wraps', row = classify(source)[0];
  const typography = { lists: { ol: { paddingLeft: 40, marginTop: 7, marginBottom: 11,
    item: { fontSize: 18, lineHeight: 26 }, marker: { color: '#f00' }, listStyleType: 'lower-alpha' } } };
  const value = draw(source, row, { typography });
  assert.ok(value.lines.length > 1); assert.equal(value.lines[0].pieces[0].text, 'i.');
  assert.equal(value.lines[0].pieces[0].color, '#f00');
  assert.equal(value.listIndent, 40);
  assert.ok(value.lines.slice(1).every(l => l.pieces[0].x === 40));
  assert.equal(value.lines[0].top, 7);
  for (let position = 0; position <= source.length; position++) {
    const raw = draw(source, row, { raw: true });
    const caret = caretSource(raw, position);
    assert.equal(hitSource(raw, caret.x, caret.y, source.length), position);
  }
  assert.equal(listMarker({ ordered: true, number: 29 }, 'upper-roman'), 'XXIX.');
  assert.equal(listMarker({ ordered: true, number: 27 }, 'lower-alpha'), 'aa.');
});

test('lists inside Callouts and quotes work without consuming fences, rules, or formulas', () => {
  const source = '> [!note] Title\n> - One\n>   1. Two\n>      more\n>\n> ```md\n> - code\n> ```\n> $$x\n> -y$$\n\n> - Quote\n>   continuation';
  const rows = classify(source);
  for (const i of [1, 2, 3, 11, 12]) assert.ok(rows[i].list, String(i));
  for (const i of [0, 5, 6, 7, 8, 9]) assert.equal(rows[i].list, undefined, String(i));
  const layout = draw(source.split('\n')[1], rows[1]);
  const bullet = layout.lines[0].pieces.find(p => p.listMarker);
  assert.equal(bullet.from, 2); assert.equal(bullet.to, 4);
});

test('loose lists retain paragraphs and CRLF source without turning blanks into items', () => {
  const source = '- First\r\n\r\n  Paragraph\r\n\r\n- Second\r\n';
  const model = new CanvasDocument(source), rows = classifyLines(model.doc);
  assert.ok(rows[0].list.loose); assert.ok(rows[2].list.loose);
  assert.equal(rows[2].list.first, false); assert.equal(rows[1].list, undefined);
  assert.equal(model.getText(), source);
  model.select(0); model.replaceSelection('Before\r\n'); model.undo(); assert.equal(model.getText(), source);
});
