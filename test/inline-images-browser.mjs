import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

export async function testInlineImagesAndCaret(page) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addStyleTag({ content: `#write{font:20px/1.6 Arial;color:#223344;min-height:0!important}
    #write p{margin:8px 0}#write strong{font-family:Georgia;font-weight:800;color:rgb(160,30,40);font-size:1.1em}
    #write em{font-style:italic;color:rgb(20,120,60)}#write img{max-width:100%;height:auto}
    #write img.obsidian-image{border:0}#write .md-image:has(>img.obsidian-image){display:block}
    #write p:has(img){margin:13px 0 17px}#write img[alt="styled"]{width:123px;margin-left:31px}` });
  const pluginSource = await readFile('test/fixtures/obsidian-images-plugin.cjs', 'utf8');
  const source = '# Test\n\n**$a$** **前 $b$ 后** *$c$* ***$d$***\n\n![[sample.svg|R|160]]\n\n![[sample.svg|80|L]]\n\n![styled](sample.svg)\n\n结束。';
  const result = await page.evaluate(async ({ source, pluginSource }) => {
    const module = { exports: {} }; class BasePlugin {}
    new Function('BasePlugin', 'module', pluginSource)(BasePlugin, module);
    const plugin = new module.exports.plugin(); plugin.config = { ENABLE: true }; plugin.utils = {};
    // Parsing and CSS decoration are the actual installed module. The browser
    // fixture substitutes filesystem transport with a deterministic SVG URL.
    const url = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#fc3e15"/></svg>');
    const write = document.querySelector('#write'); write.style.display = '';
    const base = window.module.exports.createImageAdapter({ plugin, write });
    window.imageAdapterTest = { ...base, resolve: async () => url };
    const getTheme = () => window.module.exports.readCanvasTheme({ write, content: document.querySelector('#content') });
    window.inlineFormulaRequests = []; window.inlineOriginalWorker = window.Worker;
    window.Worker = new Proxy(window.Worker, { construct(Target, args) {
      const worker = Reflect.construct(Target, args), send = worker.postMessage.bind(worker);
      worker.postMessage = request => { if (request.tex) window.inlineFormulaRequests.push(request); return send(request); }; return worker;
    } });
    window.pure = window.module.exports.mountCanvasEditor({ markdown: source, images: window.imageAdapterTest, theme: getTheme(), getTheme });
    const theme = getTheme();
    return { inline: theme.typography.inline };
  }, { source, pluginSource });
  assert.equal(result.inline.strong.fontWeight, '800'); assert.equal(result.inline.strong.color, 'rgb(160, 30, 40)');
  assert.ok(Math.abs(result.inline.strong.fontSizeScale - 1.1) < .01);
  await page.waitForFunction(() => window.pure.getStats().previewFormulas === 4 && window.pure.getStats().readyAssets >= 5);
  const formulas = await page.evaluate(() => window.inlineFormulaRequests);
  assert.equal(formulas.find(r => r.tex === 'a').options.color, 'rgb(160, 30, 40)');
  assert.equal(formulas.find(r => r.tex === 'a').options.size, 22);
  assert.equal(formulas.find(r => r.tex === 'c').options.color, 'rgb(20, 120, 60)');
  const imageGeometry = await page.evaluate(() => {
    const canvas = window.pure.host.shadowRoot.querySelector('canvas'), ctx = canvas.getContext('2d');
    return [4, 6, 8].map(i => {
      const rect = window.pure.getLineRect(i), data = ctx.getImageData(0, Math.floor(rect.y), canvas.width, Math.ceil(rect.height));
      let min = Infinity, max = -1, count = 0;
      for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) {
        const p = (y * data.width + x) * 4;
        if (data.data[p] > 230 && data.data[p + 1] < 100 && data.data[p + 2] < 70) { min = Math.min(min, x); max = Math.max(max, x); count++; }
      }
      return { min, max, count, rect };
    });
  });
  assert.equal(imageGeometry[0].max - imageGeometry[0].min + 1, 160);
  assert.equal(imageGeometry[1].max - imageGeometry[1].min + 1, 80);
  assert.equal(imageGeometry[2].max - imageGeometry[2].min + 1, 123);
  assert.ok(imageGeometry[0].min > imageGeometry[1].min + 300);
  assert.ok(Math.abs(imageGeometry[2].min - imageGeometry[2].rect.x - 31) < 2);
  assert.equal(await page.locator('[data-typora-canvas-image-probe]').count(), 0);
  // Editing inside nested math exposes the original source and arrowing out
  // restores its preview without replacing the document.
  await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+End');
  assert.equal(await page.evaluate(() => window.pure.getText()), source);
  await page.evaluate(() => { window.pure.destroy(); window.Worker = window.inlineOriginalWorker; });

  const nativeImage = await page.evaluate(async () => {
    const bridge = window.module.exports.createNativeCalloutRenderer({ write: document.querySelector('#write'),
      plugin: window.calloutTestPlugin, images: window.imageAdapterTest });
    try {
      const result = await bridge.render({ markdown: '> [!note] 图片与公式\n> ![[sample.svg|R|120]]\n> **$e$**', width: 600 });
      const ctx = result.image.getContext('2d'), data = ctx.getImageData(0, 0, result.image.width, result.image.height);
      let min = Infinity, max = -1;
      for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) {
        const p = (y * data.width + x) * 4;
        if (data.data[p] > 230 && data.data[p + 1] < 100 && data.data[p + 2] < 70) { min = Math.min(min, x); max = Math.max(max, x); }
      }
      const output = { redWidth: (max - min + 1) / result.ratio, min: min / result.ratio, errors: result.formulaErrors, height: result.height };
      result.image.width = result.image.height = 0; return output;
    } finally { bridge.destroy(); }
  });
  assert.equal(nativeImage.redWidth, 120); assert.ok(nativeImage.min > 300); assert.deepEqual(nativeImage.errors, []);
  assert.ok(nativeImage.height < 400);

  for (const native of [false, true]) {
    const calloutSource = '前一行\n\n> [!note] 设计与校核的区别\n> 正文内容\n\n后一行';
    await page.evaluate(({ source, native }) => {
      const write = document.querySelector('#write');
      const nativeCallouts = native ? window.module.exports.createNativeCalloutRenderer({ write, plugin: window.calloutTestPlugin }) : null;
      window.pure = window.module.exports.mountCanvasEditor({ markdown: source, nativeCallouts });
    }, { source: calloutSource, native });
    const host = page.locator('[data-typora-canvas-editor]');
    await page.waitForFunction(() => window.pure.getStats().drawnLines > 0);
    const start = calloutSource.indexOf('> [!note]');
    for (const local of [2, 3, 5, 8, 9]) {
      // Set the public document selection, then resynchronize through Home and
      // actual keyboard events. No private key handlers are invoked by tests.
      await page.evaluate(pos => window.pure.model.select(pos), start);
      await host.locator('textarea').focus(); await page.keyboard.press('Home');
      for (let i = 0; i < local; i++) await page.keyboard.press('ArrowRight');
      assert.equal((await page.evaluate(() => window.pure.getStats())).selection.head, start + local);
      await page.keyboard.press('ArrowLeft');
      assert.equal((await page.evaluate(() => window.pure.getStats())).selection.head, start + local - 1);
      await page.keyboard.press('ArrowRight');
      assert.equal((await page.evaluate(() => window.pure.getStats())).selection.head, start + local);
      await page.keyboard.press('ArrowDown');
      assert.ok((await page.evaluate(() => window.pure.getStats())).selection.head > start + calloutSource.split('\n')[2].length);
      await page.evaluate(pos => window.pure.model.select(pos), start);
      await page.keyboard.press('Home'); for (let i = 0; i < local; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowUp'); assert.ok((await page.evaluate(() => window.pure.getStats())).selection.head < start);
    }
    await page.keyboard.press('Control+End'); await page.waitForTimeout(120);
    const line = await page.evaluate(() => window.pure.getLineRect(2)), main = await host.locator('main').boundingBox();
    await page.mouse.click(main.x + line.x + 20, main.y + line.y + Math.min(20, line.height / 2));
    const entered = (await page.evaluate(() => window.pure.getStats())).selection.head;
    assert.ok(entered >= start && entered < start + calloutSource.split('\n')[2].length);
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    assert.equal((await page.evaluate(() => window.pure.getStats())).selection.head, start + 1);
    assert.equal(await page.evaluate(() => window.pure.getText()), calloutSource);
    await page.evaluate(() => window.pure.destroy());
  }
}
