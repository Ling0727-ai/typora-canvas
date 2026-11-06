import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function testFormulaIsolation(page) {
  await page.setViewportSize({ width: 1280, height: 1200 });
  const excerpt = await readFile(new URL('./fixtures/fatigue-math.md', import.meta.url), 'utf8');
  await page.evaluate(() => {
    window.originalFormulaWorker = window.Worker;
    window.formulaSubmissions = [];
    window.Worker = new Proxy(window.Worker, { construct(Target, args) {
      const worker = Reflect.construct(Target, args), send = worker.postMessage.bind(worker);
      worker.postMessage = data => {
        if (typeof data.tex === 'string') {
          window.formulaSubmissions.push(data.tex);
          // Simulate one hung equation in the real MathJax worker pipeline.
          if (data.tex.includes('__CANVAS_TIMEOUT_TEST__')) return;
        }
        return send(data);
      };
      return worker;
    } });
  });
  try {
    const source = '# Formula isolation\n\n$x^2$\n\n$$\\text{__CANVAS_TIMEOUT_TEST__}\n+\\sigma_m\\qquad\n+\\sigma_a$$\n\n$y^2$\n\n' + excerpt;
    await page.evaluate(markdown => { window.pure = window.module.exports.mountCanvasEditor({ markdown }); }, source);
    await page.waitForFunction(() => window.pure.getStats().readyAssets >= 1);
    // No tail disappears while pending. A failed block must keep these lines.
    for (const i of [4, 5, 6]) assert.ok((await page.evaluate(i => window.pure.getLineRect(i), i)).height > 10);
    const healthyPixels = () => page.evaluate(() => {
      const rect = window.pure.getLineRect(2), canvas = document.querySelector('[data-typora-canvas-editor]').shadowRoot.querySelector('canvas');
      const pixels = canvas.getContext('2d').getImageData(Math.floor(rect.x), Math.floor(rect.y), Math.floor(rect.width), Math.floor(rect.height));
      return { rect, data: Array.from(pixels.data) };
    });
    const before = await healthyPixels();
    try {
      await page.waitForFunction(() => {
        const s = window.pure.getStats(); return s.failedAssets === 1 && !s.formulas.active && s.formulas.queued === 0 && s.readyAssets >= 16;
      });
    } catch (error) {
      console.log(await page.evaluate(() => window.pure.getStats())); throw error;
    }
    const stats = await page.evaluate(() => window.pure.getStats());
    assert.equal(stats.formulas.failed, 1); assert.equal(stats.formulas.restarts, 1);
    assert.equal(await page.evaluate(() => window.pure.getText()), source);
    for (const i of [4, 5, 6]) assert.ok((await page.evaluate(i => window.pure.getLineRect(i), i)).height > 10);
    assert.deepEqual(await healthyPixels(), before, 'a failed formula must leave existing formula pixels and geometry intact');
    const submissions = await page.evaluate(() => window.formulaSubmissions);
    assert.equal(submissions.filter(tex => tex === 'x^2').length, 1);
    assert.equal(submissions.filter(tex => tex.includes('__CANVAS_TIMEOUT_TEST__')).length, 1);
    await page.waitForTimeout(600);
    assert.deepEqual((await page.evaluate(() => window.pure.getStats())).formulas, stats.formulas, 'failure must not start an automatic retry loop');
    await page.screenshot({ path: 'test-output/formula-isolation.png' });
    await page.evaluate(() => window.pure.destroy());
  } finally {
    await page.evaluate(() => { window.Worker = window.originalFormulaWorker; });
  }
  // More than the old 48-entry limit in a single visible logical line used to
  // continuously evict/requeue pending jobs and leak decoded-byte accounting.
  const dense = Array.from({ length: 100 }, (_, i) => `$x_{${i}}$`).join(' ');
  await page.evaluate(markdown => { window.pure = window.module.exports.mountCanvasEditor({ markdown }); }, dense);
  await page.waitForFunction(() => window.pure.getStats().readyAssets === 100 && window.pure.getStats().previewFormulas === 100);
  const denseStats = await page.evaluate(() => window.pure.getStats());
  assert.equal(denseStats.failedAssets, 0); assert.equal(denseStats.formulas.submitted, 100);
  assert.ok(denseStats.assetBytes < 32 * 1024 * 1024);
  await page.waitForTimeout(600);
  assert.deepEqual((await page.evaluate(() => window.pure.getStats())).formulas, denseStats.formulas);
  assert.equal((await page.evaluate(() => window.pure.getStats())).assetBytes, denseStats.assetBytes);
  await page.screenshot({ path: 'test-output/formulas-dense.png' });
  await page.evaluate(() => window.pure.destroy());
  console.log(JSON.stringify({ denseFormulas: denseStats.formulas, denseAssetBytes: denseStats.assetBytes }));
  const overBudget = Array.from({ length: 300 }, (_, i) => `$z_{${i}}$`).join(' ');
  await page.evaluate(markdown => { window.pure = window.module.exports.mountCanvasEditor({ markdown }); }, overBudget);
  await page.waitForFunction(() => window.pure.getStats().readyAssets === 256 && !window.pure.getStats().formulas.active);
  const capped = await page.evaluate(() => window.pure.getStats());
  await page.waitForTimeout(400);
  assert.equal(capped.formulas.submitted, 256);
  assert.deepEqual((await page.evaluate(() => window.pure.getStats())).formulas, capped.formulas);
  assert.equal(await page.evaluate(() => window.pure.getText()), overBudget);
  await page.evaluate(() => window.pure.destroy());
}
