import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { enterList } from '../src/list-commands.js';
import { enterQuote } from '../src/quote-commands.js';
import { listMarker } from '../src/lists.js';
import { layoutSourceLine, hitSource, caretSource } from '../src/editor-layout.js';

function apply(source, position = source.length, head = position) {
  const model = new CanvasDocument(source); model.select(position, head);
  const rows = classifyLines(model.doc), change = enterList(model, rows) || enterQuote(model, rows);
  return { model, rows, change };
}
const layout = (text, row, overrides = {}) => layoutSourceLine({ font: '' }, text, row, { width: 500,
  size: 18, raw: false, asset: () => null, measure: (_, value) => [...value].length * 10, ...overrides });

test('bare bullet markers each render a dot, including the active empty item with a reachable caret', () => {
  const source = '-\n*', rows = classifyLines(new CanvasDocument(source).doc);
  for (let i = 0; i < 2; i++) {
    const text = source.split('\n')[i];
    assert.ok(rows[i].list?.first);
    for (const raw of [false, true]) {
      const value = layout(text, rows[i], { raw, cursor: text.length });
      assert.equal(value.lines[0].pieces.find(p => p.listMarker)?.text, '•');
      assert.equal(value.lines[0].pieces.some(p => ['-', '*'].includes(p.text)), false);
      const caret = caretSource(value, text.length);
      assert.ok(caret.x >= 36); assert.equal(hitSource(value, caret.x, caret.y, text.length), text.length);
    }
    const raw = layout(text, rows[i], { raw: true, cursor: 0 });
    assert.equal(raw.lines[0].pieces[0].text, text);
  }
});

test('Enter continues/splits/exits numeric and unordered items in one undo step', () => {
  for (const [source, caret, expected] of [
    ['1. a\n2. b\n3. c', 9, '1. a\n2. b\n3. \n4. c'],
    ['1. a', 4, '1. a\n2. '], ['1. a\n2. ', 8, '1. a\n'],
    ['1. a\n2.', 7, '1. a\n'], ['- a\n- b\n- c', 7, '- a\n- b\n- \n- c'],
    ['* a', 3, '* a\n* '], ['+ a\n+ ', 6, '+ a\n'], ['- ab', 3, '- a\n- b'],
    ['> - ab', 5, '> - a\n> - b'], ['  - a\n  - ', 10, '  - a\n  '],
    ['1. abcd', 4, '1. a\n2. bcd'], ['- a', 0, '\n- a'],
  ]) {
    const { model, change } = apply(source, caret);
    assert.ok(change, source); assert.equal(model.getText(), expected, source);
    model.undo(); assert.equal(model.getText(), source); model.redo(); assert.equal(model.getText(), expected);
  }
  const selected = apply('1. abcd\n2. last', 4, 6);
  assert.equal(selected.model.getText(), '1. a\n2. d\n3. last'); selected.model.undo();
  assert.deepEqual(selected.model.selection, { anchor: 4, head: 6 });
});

test('extended decimal, alphabetic and Roman markers render and continue without changing alphabets', () => {
  for (const [source, expected, labels] of [
    ['(1) a\n(2) b', '(1) a\n(2) b\n(3) ', ['(1)', '(2)']],
    ['a. a\nb. b\nc. c', 'a. a\nb. b\nc. c\nd. ', ['a.', 'b.', 'c.']],
    ['i. a\nii. b\niii. c\niv. d', 'i. a\nii. b\niii. c\niv. d\nv. ', ['i.', 'ii.', 'iii.', 'iv.']],
    ['I. a\nII. b', 'I. a\nII. b\nIII. ', ['I.', 'II.']],
    ['(a) a\n(b) b', '(a) a\n(b) b\n(c) ', ['(a)', '(b)']],
  ]) {
    const { model, rows, change } = apply(source);
    assert.ok(change); assert.equal(model.getText(), expected);
    assert.deepEqual(rows.map(r => listMarker(r.list, 'decimal')), labels);
  }
});

test('renumbering siblings preserves nested counters and adjusts block indentation when marker width grows', () => {
  const source = '8. a\n9. b\n   - child\n     ```js\n     const n = 1;\n     ```\n10. c\n\nAfter\n\n1. Other';
  const { model } = apply(source, 4);
  assert.equal(model.getText(), '8. a\n9. \n10. b\n    - child\n      ```js\n      const n = 1;\n      ```\n11. c\n\nAfter\n\n1. Other');
  const rows = classifyLines(model.doc);
  assert.equal(rows[3].list.depth, 1); assert.equal(rows[5].type, 'code');
  model.undo(); assert.equal(model.getText(), source);
  const nested = apply('- Outer\n  1. a\n  2. b\n- Last', 14);
  assert.equal(nested.model.getText(), '- Outer\n  1. a\n  2. \n  3. b\n- Last');
});

test('lists contain code fences, Callouts, quotes and mixed nested lists with exact source hit ranges', () => {
  const source = '- Outer\n  ```js\n  const x = 1;\n  ```\n  > [!note] Nested\n  > Body $a$\n  >\n  > - Inside\n\n  > Quote\n- > [!proof] Direct\n  > body\n- Last';
  const model = new CanvasDocument(source), rows = classifyLines(model.doc);
  assert.equal(rows[1].type, 'code-fence'); assert.equal(rows[2].type, 'code'); assert.equal(rows[3].codeFooter, true);
  assert.equal(rows[4].calloutHeader.type, 'note'); assert.equal(rows[5].callouts[0].type, 'note');
  assert.equal(rows[7].list.depth, 1); assert.equal(rows[9].type, 'quote');
  assert.equal(rows[10].calloutHeader.type, 'proof'); assert.equal(rows[11].callouts[0].type, 'proof');
  for (const i of [0, 2, 4, 5, 7, 9, 10, 11, 12]) {
    const text = source.split('\n')[i], value = layout(text, rows[i]);
    for (const p of value.lines.flatMap(l => l.pieces).filter(p => !p.listMarker && !p.tex)) assert.equal(text.slice(p.from, p.to), p.text, `${i}: ${JSON.stringify(p)}`);
  }
  const split = apply('- > [!note] Title', 17);
  assert.equal(split.model.getText(), '- > [!note] Title\n  > ');
  const unclosed = classifyLines(new CanvasDocument('- Item\n  ```js\n  const a = 1;\n- Last\n\nBody').doc);
  assert.equal(unclosed[3].type, 'paragraph'); assert.equal(unclosed[5].type, 'paragraph');
});

test('list edits preserve CRLF and do not hijack code or selections across physical lines', () => {
  const { model } = apply('1. a\r\n2. b', 4);
  assert.equal(model.getText(), '1. a\r\n2. \r\n3. b');
  const empty = apply('1. a\r\n2. \r\nAfter', 9);
  assert.equal(empty.model.getText(), '1. a\r\n\r\nAfter');
  for (const [source, position, head] of [['```md\n- a\n```', 9, 9], ['- a\n- b', 3, 6], ['- Item\n  ```\n  - code\n  ```', 21, 21]]) {
    assert.equal(apply(source, position, head).change, null);
  }
});

test('Callout and quote lists nest by indentation and auto-number only siblings at the current depth', () => {
  const source = '> [!note] Outer\n> 1. Parent\n>    - Child\n>      (1) Deep\n>      (2) Next\n>    - Other\n> 2. Parent two\n>\n> > [!tip] Inner\n> > i. Roman\n> > ii. Next Roman';
  const rows = classifyLines(new CanvasDocument(source).doc);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9, 10].map(i => rows[i].list.depth), [0, 1, 2, 2, 1, 0, 0, 0]);
  const { model } = apply(source, source.indexOf('Deep') + 4);
  assert.equal(model.getText(), source.replace('(1) Deep\n>      (2) Next', '(1) Deep\n>      (2) \n>      (3) Next'));
  const continuation = apply('> - Item\n>   continuation');
  assert.equal(continuation.model.getText(), '> - Item\n>   continuation\n> - ');
  const cite = apply('> 1. Parent\n>    - Inner\n>      1. Deep\n>      2. Next', 39);
  assert.equal(cite.model.getText(), '> 1. Parent\n>    - Inner\n>      1. Deep\n>      2. \n>      3. Next');
  const isolated = classifyLines(new CanvasDocument('- > [!note] Title\n  > Body\n- > Ordinary quote').doc);
  assert.equal(isolated[0].calloutHeader.end, 1);
  assert.equal(isolated[2].callouts.length, 0);
});
