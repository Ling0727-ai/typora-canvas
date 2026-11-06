import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testCalloutsAndTheme } from './callouts-browser.mjs';
import { testTableToolbar } from './table-toolbar-browser.mjs';
import { testNativeCallouts } from './native-callouts-browser.mjs';
import { testBlocksAndTheme } from './blocks-browser.mjs';
import { testFormulaIsolation } from './formulas-browser.mjs';
import { testDisplayMathSpacing } from './math-spacing-browser.mjs';

const server = spawn(process.execPath, ['scripts/serve.mjs'], { stdio: 'pipe', env: { ...process.env, PORT: '4174' } });
let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview server timeout')), 20000);
    server.stdout.on('data', data => { if (data.toString().includes('Preview:')) { clearTimeout(timeout); resolve(); } });
    server.stderr.on('data', data => process.stderr.write(data));
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Preview server exited ${code}`)); });
  });
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:4174');
  await page.locator('#sample').click();
  await page.waitForFunction(() => window.demoReader?.getStats().drawnBlocks > 0);
  const initial = await page.evaluate(() => window.demoReader.getStats());
  assert.ok(initial.blocks > 8000);
  assert.ok(initial.drawnBlocks < 100);
  assert.ok(initial.cachedLayouts < 100);
  assert.ok(initial.canvasHeight <= 800);
  for (const block of [1000, 4000, 7500, 200, 8500, 0]) {
    await page.evaluate(block => window.demoReader.scrollToBlock(block), block);
    await page.waitForTimeout(150);
    const stats = await page.evaluate(() => window.demoReader.getStats());
    assert.ok(stats.drawnBlocks > 0);
    assert.ok(stats.cachedLayouts <= 256);
    assert.ok(stats.cachedMeasures <= 8192);
    assert.equal(stats.domNodes, initial.domNodes);
  }
  await page.keyboard.press('Control+f');
  await page.getByRole('searchbox', { name: '搜索全文', exact: true }).fill('第 999 节');
  await page.waitForTimeout(250);
  await page.getByText('1/2 块', { exact: true }).waitFor();
  const searched = await page.evaluate(() => window.demoReader.getStats());
  assert.ok(searched.scrollTop > initial.totalHeight / 2);
  await page.setViewportSize({ width: 700, height: 600 });
  await page.waitForTimeout(200);
  const resized = await page.evaluate(() => window.demoReader.getStats());
  assert.equal(resized.canvasWidth, 700);
  assert.ok(resized.drawnBlocks > 0);
  await mkdir('test-output', { recursive: true });
  await page.screenshot({ path: 'test-output/preview.png' });
  await writeFile('test-output/metrics.json', JSON.stringify({ initial, searched, resized }, null, 2));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-typora-canvas]').count(), 0);
  // Reopening does not retain the prior viewer or its event handlers.
  await page.locator('#sample').click();
  await page.waitForFunction(() => window.demoReader?.getStats().drawnBlocks > 0);
  await page.getByRole('button', { name: '返回编辑 · Esc' }).click();
  assert.equal(await page.locator('[data-typora-canvas]').count(), 0);
  // Embedded mode stays inside the original editor pane without extra chrome.
  await page.evaluate(() => {
    const pane = document.createElement('div');
    pane.id = 'editor-pane';
    Object.assign(pane.style, { position: 'fixed', left: '240px', top: '40px', right: '0', bottom: '24px', visibility: 'hidden' });
    document.body.append(pane);
    window.embeddedReader = window.mountCanvasReader({ parent: pane, embedded: true,
      markdown: '# Embedded\n\nOriginal pane content.\n\n## Second\n\nSecond match.' });
  });
  await page.waitForFunction(() => window.embeddedReader.getStats().drawnBlocks > 0);
  const host = page.locator('#editor-pane > [data-typora-canvas]');
  const bounds = await host.boundingBox();
  assert.deepEqual(bounds, { x: 240, y: 40, width: 460, height: 536 });
  assert.equal(await host.locator('header').isVisible(), false);
  assert.equal(await host.locator('.notice').isVisible(), false);
  assert.equal(await host.locator('footer').isVisible(), false);
  await page.keyboard.press('Control+f');
  await host.getByRole('searchbox').fill('Second');
  await page.waitForTimeout(200);
  await host.getByText('1/2 块', { exact: true }).waitFor();
  await page.keyboard.press('Enter');
  await host.getByText('2/2 块', { exact: true }).waitFor();
  await host.getByRole('button', { name: '正则表达式', exact: true }).click();
  await host.getByRole('searchbox').fill('^Second( match\\.)?$');
  await host.getByText('1/2 块', { exact: true }).waitFor();
  await host.getByRole('searchbox').fill('[');
  await host.locator('.matches').filter({ hasText: '搜索错误' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await host.locator('header').isVisible(), false);
  assert.equal(await host.count(), 1);
  await page.screenshot({ path: 'test-output/embedded.png' });
  await page.keyboard.press('Escape');
  assert.equal(await host.count(), 0);
  await page.setContent(await readFile('test/fixtures/native.html', 'utf8'));
  await page.addScriptTag({ content: 'window.module = { exports: {} };' });
  await page.addScriptTag({ path: 'dist/plugin/canvas_reader/runtime.cjs' });
  const regexSafety = await page.evaluate(async () => {
    const search = new window.module.exports.BlockSearch();
    let heartbeat = false, error = '';
    setTimeout(() => { heartbeat = true; }, 20);
    try { await search.search(['a'.repeat(30000) + '!'], '^(a+)+$', { regex: true }); }
    catch (e) { error = e.message; }
    const result = await search.search(['alpha123'], '^alpha\\d+$', { regex: true });
    return { heartbeat, error, blocks: result.blocks };
  });
  assert.equal(regexSafety.heartbeat, true);
  assert.ok(regexSafety.error.includes('超时'));
  assert.deepEqual(regexSafety.blocks, [0]);
  const original = await page.locator('#write').innerHTML();
  const themeBox = await page.locator('#themed').boundingBox();
  await page.screenshot({ path: 'test-output/native-before.png' });
  await page.evaluate(() => {
    window.hybrid = window.module.exports.mountHybrid({ content: document.querySelector('#content'), write: document.querySelector('#write'), idleDelay: 20 });
  });
  await page.waitForFunction(() => window.hybrid.getStats().captures > 0 && window.hybrid.getStats().hiddenBlocks > 0);
  // Cached snapshots use native geometry/CSS. Complex math/extensions stay live.
  assert.deepEqual(await page.locator('#themed').boundingBox(), themeBox);
  assert.equal(await page.locator('#math').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('#callout').evaluate(el => getComputedStyle(el).opacity), '1');
  const hybridStats = await page.evaluate(() => window.hybrid.getStats());
  assert.ok(hybridStats.hiddenBlocks > 0, JSON.stringify(hybridStats));
  assert.ok(hybridStats.cacheBytes <= 24 * 1024 * 1024);
  await page.screenshot({ path: 'test-output/hybrid-cached.png', caret: 'initial' });
  // A click edits at the native caret; no mode-switch hotkey is necessary.
  await page.locator('#editable').click();
  assert.equal(await page.locator('.tc-hybrid-cached').count(), 0);
  assert.equal(await page.locator('#write').getAttribute('contenteditable'), 'true');
  await page.keyboard.press('End');
  await page.keyboard.insertText('直接输入中文');
  assert.ok((await page.locator('#editable').innerText()).includes('直接输入中文'));
  await page.keyboard.press('Control+z');
  assert.ok(!(await page.locator('#editable').innerText()).includes('直接输入中文'));
  // IME events never replace the editable subtree or focus a Canvas surrogate.
  await page.locator('#write').dispatchEvent('compositionstart');
  assert.equal((await page.evaluate(() => window.hybrid.getStats())).hiddenBlocks, 0);
  await page.locator('#write').dispatchEvent('compositionend');
  const passedThrough = await page.locator('#write').evaluate(el => {
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    el.dispatchEvent(event); return !event.defaultPrevented;
  });
  assert.equal(passedThrough, true, 'native find/regex shortcuts must reach Typora');
  await page.locator('#sidebar').click();
  await page.waitForFunction(() => window.hybrid.getStats().hiddenBlocks > 0);
  // Theme changes invalidate bitmaps; formulas and native CSS are not re-parsed.
  await page.evaluate(() => document.body.classList.add('dark'));
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-output/hybrid-dark.png', caret: 'initial' });
  await page.evaluate(() => window.hybrid.destroy());
  assert.equal(await page.locator('[data-typora-canvas-hybrid]').count(), 0);
  assert.equal(await page.locator('.tc-hybrid-cached').count(), 0);
  // Chromium's native contenteditable undo may leave semantically empty style="".
  assert.equal((await page.locator('#write').innerHTML()).replace(/ style=""/g, ''), original);
  const pureSource = '# Pure Canvas\n\n正文 **粗体** 与 $x^2$。\n\n$$\n\\frac{1}{2}+\\int_0^1 x^2 dx\n$$\n\n![square](data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2260%22%20height=%2240%22%3E%3Crect%20width=%2260%22%20height=%2240%22%20fill=%22red%22/%3E%3C/svg%3E)\n\n尾行';
  await page.evaluate(source => {
    window.pure = window.module.exports.mountCanvasEditor({ markdown: source, onSave: async value => { window.pureSaved = value; } });
  }, pureSource);
  await page.waitForFunction(() => window.pure.getStats().readyAssets >= 3);
  const pureHost = page.locator('[data-typora-canvas-editor]');
  assert.equal(await pureHost.locator('p,h1,mjx-container,img,[contenteditable=true]').count(), 0);
  assert.equal(await pureHost.locator('textarea').count(), 1);
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' 编辑成功');
  assert.equal(await page.evaluate(() => window.pure.getText()), pureSource + ' 编辑成功');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.pure.getText()), pureSource);
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.evaluate(() => window.pure.getText()), pureSource + ' 编辑成功');
  // Composition updates the scoped input, not a full-document DOM editor.
  await pureHost.locator('textarea').dispatchEvent('compositionstart');
  await page.keyboard.insertText('中文组合');
  await pureHost.locator('textarea').dispatchEvent('compositionend');
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(() => window.pure.getText()), pureSource + ' 编辑成功中文组合');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.pure.getText()), pureSource + ' 编辑成功');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.pureSaved !== undefined);
  assert.equal(await page.evaluate(() => window.pureSaved), pureSource + ' 编辑成功');
  await page.keyboard.press('Control+f');
  await pureHost.getByRole('button', { name: '正则表达式', exact: true }).click();
  await pureHost.getByRole('searchbox').fill('^# Pure Canvas$');
  await pureHost.locator('.find-status').filter({ hasText: '1/1 行' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const inkPixels = await pureHost.locator('canvas').evaluate(el => {
    const data = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let ink = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) ink++;
    return ink;
  });
  assert.ok(inkPixels > 100, `Expected Canvas text pixels, got ${inkPixels}`);
  await page.screenshot({ path: 'test-output/pure-canvas-editor.png', caret: 'initial' });
  const pureStats = await page.evaluate(() => window.pure.getStats());
  await page.evaluate(() => window.pure.destroy());
  // The host's own MathJax object must remain untouched by our isolated worker.
  await page.evaluate(() => {
    window.MathJax = Object.freeze({ version: '4.1.0', config: Object.freeze({ sentinel: true }) });
    window.pure = window.module.exports.mountCanvasEditor({ markdown: '' });
  });
  await page.keyboard.type('$\\alpha$');
  await page.waitForFunction(() => window.pure.getStats().previewFormulas === 1);
  assert.equal(await page.evaluate(() => window.pure.getText()), '$\\alpha$');
  assert.equal(await page.evaluate(() => window.MathJax.config.sentinel), true);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => window.pure.getStats().previewFormulas === 0);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.pure.getStats().previewFormulas === 1);
  await page.screenshot({ path: 'test-output/alpha-preview.png', caret: 'initial' });
  await page.evaluate(() => window.pure.destroy());
  const tableSource = '| 循环形式 | 最大值与最小值 | 平均应力 | 应力幅 |\n| --- | :---: | :---: | ---: |\n| 静应力 | $\\sigma_{\\min}=\\sigma_{\\max}$ | $\\sigma_{\\max}$ | 0 |\n| 对称循环 | $\\sigma_{\\min}=-\\sigma_{\\max}$ | 0 | $\\sigma_{\\max}$ |';
  await page.evaluate(source => { window.pure = window.module.exports.mountCanvasEditor({ markdown: source }); }, tableSource);
  await page.waitForFunction(() => window.pure.getStats().previewFormulas >= 4 && window.pure.getStats().drawnTables === 3);
  assert.equal(await page.locator('[data-typora-canvas-editor] table').count(), 0);
  await page.screenshot({ path: 'test-output/canvas-table.png', caret: 'initial' });
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.insertText('修改');
  assert.ok((await page.evaluate(() => window.pure.getText())).includes('|修改 对称循环'));
  await page.waitForFunction(() => window.pure.getStats().drawnTables === 3);
  await page.evaluate(() => window.pure.destroy());
  const bigSource = Array.from({ length: 10000 }, (_, i) => `第 ${i + 1} 行：Canvas 文档模型与视口绘制。`).join('\n');
  await page.evaluate(source => { window.pure = window.module.exports.mountCanvasEditor({ markdown: source }); }, bigSource);
  await page.waitForFunction(() => window.pure.getStats().drawnLines > 0);
  const bigBefore = await page.evaluate(() => window.pure.getStats());
  assert.ok(bigBefore.drawnLines < 100);
  assert.ok(bigBefore.scopedInputLength < 100);
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('X');
  assert.equal(await page.evaluate(() => window.pure.getText()), bigSource + 'X');
  assert.equal((await page.evaluate(() => window.pure.getStats())).structureRebuilds, bigBefore.structureRebuilds);
  for (const i of [200, 4000, 8000]) {
    await page.evaluate(i => window.pure.scrollToLine(i), i); await page.waitForTimeout(80);
  }
  const bigAfter = await page.evaluate(() => window.pure.getStats());
  assert.equal(bigAfter.domNodes, bigBefore.domNodes);
  assert.ok(bigAfter.cachedLayouts <= 256);
  await page.evaluate(() => window.pure.destroy());
  assert.equal(await page.locator('[data-typora-canvas-editor]').count(), 0);
  await testTableToolbar(page);
  await testCalloutsAndTheme(page);
  await testBlocksAndTheme(page);
  await testFormulaIsolation(page);
  await testNativeCallouts(page);
  await testDisplayMathSpacing(page);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, initial, searched, resized, hybridStats, pureStats, bigAfter }, null, 2));
} finally {
  await browser?.close(); server.kill();
}
