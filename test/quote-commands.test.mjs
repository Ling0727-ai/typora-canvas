import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { enterQuote } from '../src/quote-commands.js';

function apply(source, anchor = source.length, head = anchor) {
  const model = new CanvasDocument(source); model.select(anchor, head);
  const change = enterQuote(model, classifyLines(model.doc));
  return { model, change };
}

test('Enter continues quotes at the end, in the middle, and on Callout titles', () => {
  for (const [source, caret, expected, position] of [
    ['> a', 3, '> a\n> ', 6], ['> ab', 3, '> a\n> b', 6],
    ['> ab', 2, '> \n> ab', 5], ['> [!note] Title', 15, '> [!note] Title\n> ', 18],
    ['> [!proof] Title\n> Last', 23, '> [!proof] Title\n> Last\n> ', 26],
    ['> > ab', 5, '> > a\n> > b', 10], ['  > ab', 5, '  > a\n  > b', 10],
    ['>a', 2, '>a\n> ', 5],
  ]) {
    const { model, change } = apply(source, caret);
    assert.ok(change, source); assert.equal(model.getText(), expected);
    assert.equal(model.head, position); model.undo(); assert.equal(model.getText(), source);
    model.redo(); assert.equal(model.getText(), expected);
  }
});

test('Enter on an empty quote removes its prefix without inserting a newline', () => {
  for (const [source, expected] of [['> ', ''], ['>', ''], ['>   ', ''], ['> > ', '> '], ['> [!note] Title\n> ', '> [!note] Title\n']]) {
    const { model } = apply(source); assert.equal(model.getText(), expected);
    assert.equal(model.head, expected.length); model.undo(); assert.equal(model.getText(), source);
  }
});

test('Enter before a quote inserts above it; selection splitting preserves remaining text', () => {
  const above = apply('> [!note] Title', 0); assert.equal(above.model.getText(), '\n> [!note] Title');
  for (const [anchor, head] of [[3, 5], [5, 3]]) {
    const { model } = apply('> abcd', anchor, head);
    assert.equal(model.getText(), '> a\n> d'); assert.equal(model.head, 6);
    model.undo(); assert.deepEqual(model.selection, { anchor, head });
  }
});

test('quote edits preserve CRLF, including the final line without a terminator', () => {
  const { model } = apply('> Title\r\n> ab', 13);
  assert.equal(model.getText(), '> Title\r\n> ab\r\n> ');
  const mid = apply('> ab\r\nAfter', 3);
  assert.equal(mid.model.getText(), '> a\r\n> b\r\nAfter');
  const empty = apply('>\r\nAfter', 1);
  assert.equal(empty.model.getText(), '\r\nAfter');
});

test('plain text, fenced source, and selections spanning lines keep existing Enter handling', () => {
  for (const [source, anchor, head] of [['Plain', 5, 5], ['```text\n> a\n```', 11, 11], ['> a\n> b', 3, 6]]) {
    const { model, change } = apply(source, anchor, head);
    assert.equal(change, null); assert.equal(model.getText(), source);
  }
});
