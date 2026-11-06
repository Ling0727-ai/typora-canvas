import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { layoutSourceLine } from '../src/editor-layout.js';
import { languageSuggestions } from '../src/code-client.js';
const classify = source => classifyLines(new CanvasDocument(source).doc);
const options = { width: 400, raw: false, asset: () => null, measure: (_, text) => text.length * 10 };

test('display math accepts attached delimiters across physical lines and stays within Callouts', () => {
  const rows = classify('$$\\sigma_m=\\frac{a+b}{2},\\qquad\n\\sigma_a=\\frac{a-b}{2}$$\n\n> [!note] Formula\n> $$x\n> +y$$\n\nAfter');
  assert.equal(rows[0].tex, '\\sigma_m=\\frac{a+b}{2},\\qquad\n\\sigma_a=\\frac{a-b}{2}');
  assert.equal(rows[0].end, 1); assert.equal(rows[1].type, 'math-tail');
  assert.equal(rows[4].tex, 'x\n+y'); assert.equal(rows[5].start, 4);
  assert.equal(rows[7].type, 'paragraph');
  const brackets = classify('\\[x\n+y\\]'); assert.equal(brackets[0].tex, 'x\n+y');
  const code = classify('```latex\n$$x\n+y$$\n```'); assert.equal(code[1].type, 'code');
});

test('fences keep language metadata, closing fence and unclosed source intact', () => {
  const rows = classify('> [!note] Code\n> ```c\n> int x = 21;\n> ```\n\n~~~python\nprint(1)');
  assert.equal(rows.codeBlocks.length, 2); assert.equal(rows[1].languageFrom, 5);
  assert.equal(rows[2].codeStart, 1); assert.equal(rows[3].codeFooter, true);
  assert.equal(rows[6].language, 'python'); assert.equal(rows[6].codeEnd, 6);
  assert.ok(languageSuggestions('c').some(l => l.id === 'c'));
});

test('rules render as lines and blank runs next to headings collapse outside editing', () => {
  for (const source of ['---', '___', '***', '- - -']) {
    const row = classify(source)[0]; assert.equal(row.type, 'rule');
    const layout = layoutSourceLine({ font: '' }, source, row, options);
    assert.ok(layout.rule); assert.equal(layout.lines.length, 0);
  }
  const source = '# Title\n\n\n\nParagraph', rows = classify(source);
  for (let i = 1; i < 4; i++) assert.equal(layoutSourceLine({ font: '' }, '', rows[i], options).height, .01);
  const active = layoutSourceLine({ font: '' }, '', rows[2], { ...options, raw: true }); assert.ok(active.height > 10);
  const model = new CanvasDocument(source); assert.equal(model.getText(), source);
});

test('heading typography and code token colors come from sampled native CSS', () => {
  const heading = layoutSourceLine({ font: '' }, '# Title', classify('# Title')[0], { ...options,
    typography: { headings: [{ fontSize: 38, lineHeight: 49, color: '#004499', fontWeight: '700', marginTop: 0, marginBottom: 10 }] } });
  assert.equal(heading.fontSize, 38); assert.equal(heading.lineHeight, 49);
  assert.ok(heading.lines[0].pieces.every(p => p.color === '#004499'));
  const row = { type: 'code', codeTokens: [{ from: 0, to: 3, type: 'keyword' }] };
  const code = layoutSourceLine({ font: '' }, 'int x;', row, { ...options,
    codeStyle: { fontSize: 16, lineHeight: 24, color: '#111', tokenColors: { keyword: '#f00' } } });
  assert.equal(code.lines[0].pieces[0].color, '#f00'); assert.equal(code.lines[0].pieces.at(-1).color, '#111');
});
