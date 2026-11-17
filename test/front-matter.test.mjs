import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { layoutSourceLine } from '../src/editor-layout.js';
import { parseMarkdown } from '../src/markdown.js';

const metadata = ['---', 'aliases:', '  - 技术经济与企业管理', '  - 化工技术经济', '  - 课程索引',
  'tags:', '  - 学科', '  - 学科/技术经济', '---'].join('\n');
const classify = source => classifyLines(new CanvasDocument(source).doc);

test('course metadata stays YAML while following nested Markdown lists keep their scopes', () => {
  const source = `${metadata}\n\n- Parent\n  - Child\n- Sibling`;
  const rows = classify(source);
  assert.equal(rows.codeBlocks.length, 1);
  assert.equal(rows.codeBlocks[0].language, 'yaml');
  assert.equal(rows.codeBlocks[0].end, 8);
  for (const row of rows.slice(0, 9)) {
    assert.equal(row.frontMatter, true);
    assert.equal(row.list, undefined);
    assert.deepEqual(row.callouts, []);
    assert.equal(row.type === 'rule', false);
  }
  assert.deepEqual(rows.slice(10).map(row => row.list.depth), [0, 1, 0]);
  const blocks = parseMarkdown(source);
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].info, 'yaml');
  assert.equal(blocks[0].text, metadata.split('\n').slice(1, -1).join('\n'));
  assert.equal(blocks[1].line, 10);
});

test('front matter preserves BOM, CRLF, literal fences, quotes and Markdown inside YAML', () => {
  const source = '\uFEFF---\r\nbody: |\r\n  ```\r\n  > [!note] literal\r\n  # literal\r\n  $$literal$$\r\n...\r\n# Real heading';
  const model = new CanvasDocument(source), rows = classifyLines(model.doc);
  assert.equal(model.getText(), source);
  assert.equal(rows.calloutGroups.length, 0);
  assert.ok(rows.slice(0, 7).every(row => row.frontMatter));
  assert.equal(rows[7].type, 'heading');
  const blocks = parseMarkdown(source);
  assert.ok(blocks[0].text.includes('```'));
  assert.ok(blocks[0].text.includes('$$literal$$'));
  assert.equal(blocks[1].type, 'heading');
});

test('unclosed metadata and rules below the first line retain Markdown behavior', () => {
  for (const source of ['---', '---\n# Heading', '# Heading\n\n---\naliases:\n  - Item']) {
    const rows = classify(source);
    assert.ok(rows.every(row => !row.frontMatter));
    assert.equal(rows.codeBlocks.length, 0);
  }
  const model = new CanvasDocument(metadata);
  model.replace(0, 3, '***');
  assert.ok(classifyLines(model.doc).every(row => !row.frontMatter));
  model.undo();
  assert.ok(classifyLines(model.doc).every(row => row.frontMatter));
});

test('metadata layout keeps YAML indentation and uses its theme without a language picker', () => {
  const lines = metadata.split('\n'), rows = classify(metadata);
  const options = { width: 500, raw: false, asset: () => null, measure: (_, text) => text.length * 10,
    typography: { frontMatter: { fontSize: 16, lineHeight: 24, color: '#678', fontFamily: 'monospace',
      paddingLeft: 20, paddingTop: 12, paddingBottom: 12 } } };
  const header = layoutSourceLine({ font: '' }, lines[0], rows[0], options);
  assert.equal(header.codeBadge, undefined);
  assert.equal(header.lines.length, 0);
  assert.equal(header.height, 12);
  const body = layoutSourceLine({ font: '' }, lines[2], rows[2], options);
  assert.ok(Math.abs(body.height - 24) < 1e-9);
  const pieces = body.lines.flatMap(line => line.pieces);
  assert.equal(pieces.map(piece => piece.text).join(''), lines[2]);
  assert.equal(pieces[0].x, 20);
  assert.ok(pieces.every(piece => piece.color === '#678' && !piece.listMarker));
});
