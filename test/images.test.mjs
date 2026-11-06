import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseWikiImage, createImageAdapter } from '../src/images.js';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';

test('image grammar follows the Obsidian Images plugin and excludes code/invalid options', () => {
  for (const text of ['![[图片.png|C|500]]', '![[图片.svg|500|C]]', '![[附件/图片.jpg|l|320]]']) {
    const image = parseWikiImage(text); assert.ok(image); assert.ok(image.width > 0);
  }
  for (const text of ['![[note.md]]', '![[a.png|500x300]]', '![[a.png|0]]', '![[a.png|C|R]]']) assert.equal(parseWikiImage(text), null);
  const rows = classifyLines(new CanvasDocument('![[图片.png|500|R]]\n```md\n![[图片.png]]\n```\n`![[图片.png]]`\n\\![[图片.png]]').doc);
  assert.equal(rows[0].type, 'image'); assert.equal(rows[0].image.align, 'R'); assert.equal(rows[0].image.width, 500);
  assert.equal(rows[2].type, 'code'); assert.equal(rows[4].type, 'paragraph'); assert.equal(rows[5].type, 'paragraph');
});

test('installed plugin resolver is reused and awaited without refreshing the native document', async () => {
  const source = await readFile(new URL('./fixtures/obsidian-images-plugin.cjs', import.meta.url), 'utf8');
  const sandbox = { BasePlugin: class {}, module: { exports: {} }, File: { editor: { imgEdit: { getAbsolutePath: () => null } } } };
  vm.runInNewContext(source, sandbox);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-images-'));
  try {
    fs.mkdirSync(path.join(root, '.obsidian')); fs.mkdirSync(path.join(root, 'notes')); fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'assets', '图_1.svg'), '<svg/>');
    const plugin = new sandbox.module.exports.plugin(); plugin.config = { ENABLE: true };
    plugin.utils = { getFilePath: () => path.join(root, 'notes', 'note.md'), getMountFolder: () => root };
    const originalRoots = plugin.roots;
    const adapter = createImageAdapter({ plugin, write: {}, fs, path, toFileURL: p => pathToFileURL(p).href,
      resolveLocal: file => path.resolve(root, 'notes', file) });
    const row = adapter.parse('![[图_1.svg|R|320]]');
    assert.equal(row.image.width, 320);
    assert.equal(await adapter.resolve(row.url, row.image), pathToFileURL(path.join(root, 'assets', '图_1.svg')).href);
    assert.equal(plugin.roots, originalRoots); assert.equal(plugin.roots.size, 0, 'live plugin index stays untouched');
    plugin.config.ENABLE = false;
    assert.equal(createImageAdapter({ plugin }).parse('![[图_1.svg]]'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
