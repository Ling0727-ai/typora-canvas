import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { defaultCalloutTheme, calloutContexts } from '../src/callouts.js';
import { layoutSourceLine, hitSource, caretSource } from '../src/editor-layout.js';

test('custom/default titles, fold markers, aliases and nested quote scopes preserve source', () => {
  const source = '> [!definition] 自定义标题\n> 正文\n>\n> > [!proof]- 证明\n> > 折叠正文\n\n> [!notes]+\n> 旧别名';
  const model = new CanvasDocument(source), { contexts, groups } = calloutContexts(model.doc);
  assert.equal(groups.length, 3); assert.equal(groups[0].title, '自定义标题');
  assert.equal(groups[1].fold, '-'); assert.equal(groups[1].end, 4);
  assert.equal(contexts[4].callouts.length, 2); assert.equal(contexts[4].content, '折叠正文');
  assert.equal(groups[2].title, 'notes'); assert.equal(groups[2].fold, '+');
  assert.equal(model.getText(), source);
  const theme = defaultCalloutTheme();
  assert.equal(theme.types.notes.color, theme.types.note.color);
  assert.equal(theme.types.definitiion.color, theme.types.definition.color);
  assert.equal(theme.types.importent.color, theme.types.important.color);
  assert.notEqual(defaultCalloutTheme(true).types.note.color, theme.types.note.color);
});

test('quoted math and tables use normalized content while keeping original source offsets', () => {
  const model = new CanvasDocument('> [!theorem] 定理 $x^2$\n> $$\n> \\frac{1}{2}\n> $$\n>\n> | 项目 | 公式 |\n> | --- | --- |\n> | 结论 | $x$ |');
  const rows = classifyLines(model.doc);
  assert.equal(rows[0].type, 'callout-title');
  assert.equal(rows[1].tex, '\\frac{1}{2}'); assert.equal(rows[1].sourceOffset, 2);
  assert.equal(rows[5].type, 'table'); assert.equal(rows[6].type, 'table-separator');
  assert.equal(rows[7].callouts[0].end, 7);
});

test('callout-looking text inside fenced code remains code, not a nested group', () => {
  const model = new CanvasDocument('```md\n> [!note] literal\n```\n\n> [!note] Real\n> ```md\n> [!warning] literal\n> ```');
  const rows = classifyLines(model.doc);
  assert.equal(rows.calloutGroups.length, 1);
  assert.equal(rows[1].type, 'code'); assert.equal(rows[6].type, 'code');
});

test('disabling the custom plugin leaves native alert types but preserves other markers as source', () => {
  const model = new CanvasDocument('> [!definition] 定义\n> 正文\n\n> [!note] Native\n> Body');
  const rows = classifyLines(model.doc, { customCallouts: false });
  assert.equal(rows.calloutGroups.length, 1); assert.equal(rows[0].type, 'quote');
  assert.equal(rows[3].calloutHeader.type, 'note');
  assert.equal(model.getText().startsWith('> [!definition]'), true);
});

test('header/body geometry maps back to original Markdown and colors only the title', () => {
  const model = new CanvasDocument('> [!definition] 定义\n> 正常正文');
  const rows = classifyLines(model.doc), options = { width: 400, raw: false,
    asset: () => null, measure: (_, text) => text.length * 10 };
  const header = layoutSourceLine({ font: '' }, model.doc.line(1).text, rows[0], options);
  assert.equal(header.lines[0].pieces.map(p => p.text).join(''), '定义');
  assert.equal(header.lines[0].pieces[0].from, '> [!definition] '.length);
  assert.ok(header.lines[0].pieces.every(p => p.color === defaultCalloutTheme().types.definition.color));
  const body = layoutSourceLine({ font: '' }, model.doc.line(2).text, rows[1], options);
  assert.equal(body.lines[0].pieces[0].from, 2); assert.equal(body.lines[0].pieces[0].color, undefined);
  assert.equal(hitSource(body, 16, 10, 6), 2);
  assert.equal(caretSource(body, 2).x, 16);
  const editing = layoutSourceLine({ font: '' }, model.doc.line(1).text, rows[0], { ...options, raw: true, cursor: 4, selection: { from: 4, to: 4 } });
  assert.equal(editing.lines[0].pieces.map(p => p.text).join(''), model.doc.line(1).text);
});
