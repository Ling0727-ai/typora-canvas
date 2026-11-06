import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { headingIndex, anchorHeading, sourceLinks, safeLink } from '../src/navigation.js';

test('heading navigation indexes Unicode, formatted and duplicate headings without including fenced code', () => {
  const doc = new CanvasDocument('# 第一章 **绪论**\n\n## Same heading\n\n## Same heading\n\n```md\n# Ignored\n```').doc;
  const headings = headingIndex(doc, classifyLines(doc));
  assert.deepEqual(headings.map(h => [h.title, h.id, h.line]), [['第一章 绪论', '第一章-绪论', 0], ['Same heading', 'same-heading', 2], ['Same heading', 'same-heading-1', 4]]);
  assert.equal(anchorHeading(headings, '#%E7%AC%AC%E4%B8%80%E7%AB%A0-%E7%BB%AA%E8%AE%BA'), headings[0]);
  assert.equal(anchorHeading(headings, '#Same%20heading'), headings[1]);
  assert.equal(anchorHeading(headings, '#same-heading-1'), headings[2]);
  assert.equal(anchorHeading(headings, '#%ZZ'), null);
});

test('links retain source positions, balanced URL parentheses, titles and local fragments', () => {
  const text = '[网站](https://example.com/a(b)) [本地](<notes/my file.md#标题> "文档") [位置](#same-heading) <https://example.com> `[_](ignore)` ![image](skip)';
  const links = sourceLinks(text);
  assert.deepEqual(links.map(l => l.href), ['https://example.com/a(b)', 'notes/my file.md#标题', '#same-heading', 'https://example.com']);
  assert.equal(text.slice(links[0].from, links[0].to), '[网站](https://example.com/a(b))');
  assert.deepEqual(sourceLinks('[title](some.md "optional title")').map(l => l.href), ['some.md']);
  for (const href of ['https://example.com', 'mailto:test@example.com', './notes.md', '#标题']) assert.equal(safeLink(href), true);
  for (const href of ['javascript:alert(1)', ' data:text/html,x', 'vbscript:test', 'java\nscript:test']) assert.equal(safeLink(href), false);
});
