import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, initial, searched, resized, hybridStats }, null, 2));
} finally {
  await browser?.close(); server.kill();
}
