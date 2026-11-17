import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines, editingSourceRange } from '../src/editor-model.js';

const classify = source => classifyLines(new CanvasDocument(source).doc);

test('editing a list or quote exposes its surrounding structure through the container boundary', () => {
  for (const source of ['1. Parent\n  - Child\n  - \n\nAfter', '> - a\n> -\n\nAfter',
    '> 1. 1\n> 2. \n\nAfter', '> First\n> Second\n>\n\nAfter']) {
    const rows = classify(source), range = editingSourceRange(rows, 1, 20);
    assert.equal(range.start, 0, source);
    assert.ok(range.end < rows.length - 1, source);
    assert.equal(editingSourceRange(rows, rows.length - 1, 20), null);
  }
});

test('editing an empty nested Callout item exposes the title, siblings and parent source', () => {
  const source = '> [!note] 1\n> - 1\n>   - 1\n>   - 1\n>   - \n\nAfter';
  assert.deepEqual(editingSourceRange(classify(source), 4, 20), { start: 0, end: 4 });
});

test('source context stays bounded for large lists and leaves ordinary paragraphs alone', () => {
  const rows = classify(Array.from({ length: 10000 }, (_, i) => `- Item ${i}`).join('\n'));
  assert.deepEqual(editingSourceRange(rows, 5000, 24), { start: 4976, end: 5024 });
  assert.deepEqual(editingSourceRange(rows, 0, 24), { start: 0, end: 24 });
  assert.equal(editingSourceRange(classify('Paragraph\n\nAfter'), 0, 24), null);
});
