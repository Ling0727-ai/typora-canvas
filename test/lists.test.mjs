import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { layoutSourceLine, caretSource, hitSource } from '../src/editor-layout.js';
import { listMarker } from '../src/lists.js';
const classify = source => classifyLines(new CanvasDocument(source).doc);
const options = { width: 140, raw: false, size: 18, asset: () => ({ image: {}, width: 12, height: 17 }),
  measure: (_, text) => [...text].length * 10 };
const draw = (source, row, opts = {}) => layoutSourceLine({ font: '' }, source, row, { ...options, ...opts });

test('two-space children nest under ordered markers and preserve their source projections', () => {
  for (const source of ['1. a\n  - a', '> 1. a\n>   - a', '10. a\n  - a', '(1) a\n  - a']) {
    const rows = classify(source);
    assert.deepEqual(rows.map(row => row.list.depth), [0, 1], source);
    const values = source.split('\n').map((text, i) => draw(text, rows[i], { width: 500 }));
    const body = values.map(value => value.lines.flatMap(line => line.pieces).find(piece => !piece.listMarker && piece.text.trim()));
    assert.ok(body[1].x > body[0].x + 20, source);
    for (let i = 0; i < 2; i++) {
      const text = source.split('\n')[i];
      for (const piece of values[i].lines.flatMap(line => line.pieces).filter(piece => !piece.listMarker)) {
        assert.equal(text.slice(piece.from, piece.to), piece.text, source);
      }
    }
  }
});

test('a two-space ordered child moves both marker and body and starts its own counter', () => {
  const source = '1. 1\n2. 2\n  1. 1', rows = classify(source);
  assert.deepEqual(rows.map(row => row.list.depth), [0, 0, 1]);
  assert.deepEqual(rows.map(row => row.list.number), [1, 2, 1]);
  const values = source.split('\n').map((text, i) => draw(text, rows[i], { width: 500 }));
  const pieces = values.map(value => value.lines.flatMap(line => line.pieces));
  const markers = pieces.map(line => line.find(piece => piece.listMarker));
  const bodies = pieces.map(line => line.find(piece => !piece.listMarker));
  assert.equal(markers[2].text, '1.');
  assert.equal(markers[0].x, markers[1].x);
  assert.ok(markers[2].x > markers[1].x + 20);
  assert.equal(bodies[2].x - bodies[1].x, markers[2].x - markers[1].x);
});

test('all supported marker families mix across three levels in body, quotes and Callouts', () => {
  const markers = ['-', '+', '*', '1.', '1)', '(1)', 'a.', 'A.', 'i.', 'I.', '(a)', '(I)'];
  for (const outer of markers) for (const inner of markers) for (const wrapper of ['', '> ', '> > ', 'callout']) {
    const prefix = wrapper === 'callout' ? '> ' : wrapper;
    const source = (wrapper === 'callout' ? '> [!note] Title\n' : '') +
      `${prefix}${outer} Parent\n${prefix}  ${inner} Child\n${prefix}    - Deep\n${prefix}  ${inner} Next\n${prefix}${outer} Last`;
    const rows = classify(source).filter(row => row.list);
    assert.deepEqual(rows.map(row => row.list.depth), [0, 1, 2, 1, 0], source);
    const values = rows.map(row => draw(source.split('\n')[row.sourceLine], row, { width: 900 }));
    const bodies = values.map(value => value.lines.flatMap(line => line.pieces).find(piece => piece.text.trim() && !piece.listMarker));
    assert.ok(bodies[1].x > bodies[0].x + 15, source);
    assert.ok(bodies[2].x > bodies[1].x + 15, source);
    assert.equal(bodies[3].x, bodies[1].x, source);
    assert.equal(bodies[4].x, bodies[0].x, source);
  }
});

test('quoted list markers stay inside the quote while list-contained quotes stay inside the item', () => {
  const typography = { quote: { paddingLeft: 18, borderWidth: 3, borderColor: '#123' },
    lists: { ul: { paddingLeft: 40, item: {} }, ol: { paddingLeft: 40, item: {} } } };
  for (const source of ['> - a\n> -', '> 1. 1\n> 2. ', '> - a\n>   - b']) {
    const rows = classify(source);
    for (let i = 0; i < rows.length; i++) {
      const text = source.split('\n')[i], value = draw(text, rows[i], { width: 500, typography });
      const marker = value.lines.flatMap(line => line.pieces).find(piece => piece.listMarker);
      assert.equal(value.quoteBorders[0].x, 0, source);
      assert.ok(marker.x > value.quoteBorders[0].x + value.quoteBorders[0].width, source);
      const active = draw(text, rows[i], { width: 500, raw: true, cursor: text.length, typography });
      const pieces = active.lines.flatMap(line => line.pieces);
      assert.equal(pieces.map(piece => piece.text).join(''), text);
      assert.ok(pieces.every(piece => !piece.listMarker));
      assert.equal(active.quoteBorders, undefined);
      for (let cursor = 0; cursor <= text.length; cursor++) {
        const caret = caretSource(active, cursor);
        assert.equal(hitSource(active, caret.x, caret.y, text.length), cursor);
      }
    }
  }
  const source = '- > a', row = classify(source)[0], value = draw(source, row, { width: 500, typography });
  const marker = value.lines.flatMap(line => line.pieces).find(piece => piece.listMarker);
  assert.ok(marker.x + marker.width < value.quoteBorders[0].x);
});

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
