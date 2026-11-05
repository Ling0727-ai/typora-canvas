import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, initial, searched, resized }, null, 2));
} finally {
  await browser?.close(); server.kill();
}
