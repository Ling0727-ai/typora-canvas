import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { layoutSourceLine, hitSource, caretSource } from '../src/editor-layout.js';
import { insertBlankParagraphs } from '../src/spacing.js';

const classify = source => classifyLines(new CanvasDocument(source).doc);
const options = { width: 500, raw: false, asset: () => null, measure: (_, text) => text.length * 10,
  typography: { paragraph: { fontSize: 18, lineHeight: 28, marginTop: 12, marginBottom: 12 },
    blank: { fontSize: 18, lineHeight: 28, marginTop: 8, marginBottom: 8, minHeight: 30 } } };
const layout = (source, rows, line, raw = false) => layoutSourceLine({ font: '' }, source.split('\n')[line], rows[line], { ...options, raw });

test('only heading-adjacent body blanks collapse; single and repeated paragraph blanks remain', () => {
  const source = '## Section\n\n### Requirements\n\nFirst\n\nSecond\n\n\nThird\n\n## Next';
  const rows = classify(source);
  for (const i of [1, 3, 10]) assert.equal(layout(source, rows, i).height, .01);
  for (const i of [5, 7, 8]) {
    assert.equal(rows[i].emptyParagraph, true);
    assert.equal(layout(source, rows, i).height, 38);
    assert.equal(layout(source, rows, i, true).height, 38, 'focusing a visible blank keeps its theme geometry');
  }
  const blank = layout(source, rows, 5);
  assert.equal(hitSource(blank, 20, 5, 0), 0);
  assert.equal(caretSource(blank, 0).height, 30);
});

test('Callouts keep internal blanks and collapse only each scope’s trailing blank run', () => {
  const source = '> [!proof] Title\n> First\n>\n> ## Heading\n>\n> Second\n>\n> > [!note] Nested\n> > Body\n> >\n> >\n> After nested\n>\n>\n\nBody\n\nNext';
  const rows = classify(source);
  for (const i of [2, 4, 6, 14, 16]) assert.equal(rows[i].emptyParagraph, true, `line ${i}`);
  for (const i of [9, 10, 12, 13]) assert.equal(rows[i].emptyParagraph, false, `line ${i}`);
  assert.ok(layout(source, rows, 2).height >= 38);
  assert.equal(layout(source, rows, 12).height, .01);
});

test('empty lines within code and display formulas retain their block semantics', () => {
  const source = '> [!note] Title\n> ```text\n>\n> ```\n> $$a\n>\n> +b$$\n>\n> Last';
  const rows = classify(source);
  assert.equal(rows[2].type, 'code'); assert.equal(rows[5].type, 'math-tail');
  assert.equal(rows[2].emptyParagraph, undefined); assert.equal(rows[5].emptyParagraph, undefined);
  const model = new CanvasDocument(source.replaceAll('\n', '\r\n'));
  assert.equal(model.getText(), source.replaceAll('\n', '\r\n'));
  model.replace(0, 0, 'Before\r\n\r\n'); model.undo();
  assert.equal(model.getText(), source.replaceAll('\n', '\r\n'));
});

test('native capture restores internal blank paragraphs inside the correct nested quote', () => {
  const source = '> [!note] Outer\n> First\n>\n> Second\n> > [!proof] Inner\n> > Body\n> >\n> > Last\n> >\n> After\n>\n>\n';
  const md = new MarkdownIt(), original = md.parse(source, {});
  const tokens = insertBlankParagraphs(original, classify(source), () => new original[0].constructor('canvas_blank', 'p', 0));
  let depth = 0; const blanks = [];
  for (const token of tokens) {
    if (token.type === 'blockquote_open') depth++;
    if (token.type === 'blockquote_close') depth--;
    if (token.type === 'canvas_blank') blanks.push([token.map[0], depth]);
  }
  assert.deepEqual(blanks, [[2, 1], [6, 2], [12, 0]]);
});

test('active Callout title, body and empty quote lines expose their original prefixes and offsets', () => {
  const source = '> [!note] Title\n> Body<br>Second\n>\n> Last', rows = classify(source);
  for (const i of [0, 1, 2]) {
    const value = layout(source, rows, i, true);
    const text = value.lines.flatMap(l => l.pieces).map(p => p.text).join('');
    assert.equal(text, source.split('\n')[i]);
    const caret = caretSource(value, 0);
    assert.equal(hitSource(value, caret.x, caret.y, source.split('\n')[i].length), 0);
  }
  const preview = layout(source, rows, 1);
  assert.equal(preview.lines.length, 2);
  assert.equal(preview.lines.flatMap(l => l.pieces).filter(p => !p.break).map(p => p.text).join(''), 'BodySecond');
});

test('ordinary quotes expose the source prefix and permit a caret before it', () => {
  const source = '> Citation', rows = classify(source);
  const active = layout(source, rows, 0, true), preview = layout(source, rows, 0);
  assert.equal(active.lines[0].pieces.map(p => p.text).join(''), source);
  assert.equal(preview.lines[0].pieces.map(p => p.text).join(''), 'Citation');
  assert.equal(hitSource(active, 0, 0, source.length), 0);
});
