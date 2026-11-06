import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'smol-toml';
import { HeightIndex } from '../src/height-index.js';
import { parseMarkdown } from '../src/markdown.js';
import { LruCache, layoutBlock } from '../src/layout.js';
import { configure } from '../scripts/install.mjs';

test('height lookup agrees with a linear model after random measurements', () => {
  const heights = Array.from({ length: 1000 }, (_, i) => 20 + i % 137);
  const index = new HeightIndex(heights);
  let seed = 54321;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 500; n++) {
    const i = Math.floor(random() * heights.length), value = 1 + random() * 400;
    heights[i] = value; index.update(i, value);
    const offset = random() * index.total;
    let sum = 0, expected = 0;
    while (expected < heights.length - 1 && sum + heights[expected] <= offset) sum += heights[expected++];
    assert.equal(index.find(offset), expected);
    assert.ok(Math.abs(index.prefix(expected) - sum) < 1e-6);
  }
  assert.equal(index.find(-1), 0);
  assert.equal(index.find(index.total + 100), 999);
  assert.equal(new HeightIndex([]).find(0), 0);
});

test('Markdown preserves Chinese, styles, nested lists, tables, and inert HTML', () => {
  const blocks = parseMarkdown('# 标题\n\n**粗体**与`code` 😀\n\n3. 第一\n   - 子项\n\n> 引用\n\n| A | B |\n| - | - |\n| 一 | 二 |\n\n<script>alert(1)</script>\n\n![图](https://example.com/private.png)');
  assert.equal(blocks[0].type, 'heading');
  assert.ok(blocks[1].runs.some(r => r.bold && r.text === '粗体'));
  assert.ok(blocks.some(b => b.text.startsWith('3. ')));
  assert.ok(blocks.some(b => b.indent === 2));
  assert.equal(blocks.filter(b => b.type === 'table').length, 2);
  assert.ok(blocks.some(b => b.text.includes('<script>')));
  assert.ok(blocks.some(b => b.text.includes('[图片：图]')));
});

test('one enormous paragraph is split without losing Unicode or text', () => {
  const text = '汉字😀abc '.repeat(4000);
  const blocks = parseMarkdown(text);
  assert.ok(blocks.length > 10);
  assert.equal(blocks.map(b => b.text).join(''), text.trimEnd());
  assert.ok(blocks.every(b => Array.from(b.text).length <= 2048));
});

test('layout handles oversized tokens and explicit code newlines', () => {
  const ctx = { font: '', measureText: text => ({ width: Array.from(text).length * 10 }) };
  const blocks = parseMarkdown('abcdefghijklmno\n\n```\na\nb\nc\n```');
  const layout = layoutBlock(ctx, blocks[0], 50, new LruCache(100));
  assert.ok(layout.lines.length >= 3);
  const code = layoutBlock(ctx, blocks[1], 100, new LruCache(100));
  assert.equal(code.lines.length, 3);
});

test('installer preserves other plugins, comments, and is idempotent', () => {
  const raw = '# 我的配置\n[global]\nENABLE = true\n\n[callouts]\nENABLE = true\n';
  const installed = configure(raw, true);
  assert.equal(parse(installed).canvas_reader.AUTO_OPEN, true);
  assert.equal(parse(installed).callouts.ENABLE, true);
  assert.ok(installed.includes('# 我的配置'));
  assert.deepEqual(parse(configure(installed, true)), parse(installed));
  assert.equal(parse(configure(installed, false)).canvas_reader.ENABLE, false);
  const existing = '[canvas_reader]\nENABLE = false\nOTHER = 42\n\n[callouts]\nENABLE = true\n';
  assert.equal(parse(configure(existing, true)).canvas_reader.OTHER, 42);
  assert.equal(parse(configure(existing, true)).callouts.ENABLE, true);
  assert.equal(parse(configure(existing + '\n[other]\nENABLE = true\n', true)).other.ENABLE, true);
  assert.equal(parse(configure('[canvas_reader]\nAUTO_OPEN = false\n', true)).canvas_reader.AUTO_OPEN, false);
});
