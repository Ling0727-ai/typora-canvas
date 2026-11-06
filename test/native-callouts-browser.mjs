import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

export async function testNativeCallouts(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addStyleTag({ content: await readFile('test/fixtures/callouts-native.css', 'utf8') });
  await page.addStyleTag({ content: `.callout-folded > p:not(:first-child){display:none}
    body{background:#fff!important;color:#111!important;--bg-color:#fff;--text-color:#111}#write{font:18px/1.6 Arial,sans-serif;min-height:100vh!important}
    #write.typewriter-mode{padding-top:50%!important}
    body.native-dark{background:#121820!important;color:#eee!important;--bg-color:#121820;--text-color:#eee;--obs-note-rgb:130,170,220}
    #write .plugin-callout > p:first-child > span:first-child{font-size:0}
    #write .plugin-callout > p:first-child > span:first-child:after{content:attr(data-type)}` });
  const pluginSource = await readFile('test/fixtures/callouts-plugin.cjs', 'utf8');
  const source = '> [!note] 适用条件与单位\n> 功能主线：原动机→传动装置→执行部分；控制与辅助系统作用于相应环节。\n>\n> 公式 $\\alpha$ 与 **强调**。\n>\n> > [!proof]- 证明\n> > 隐藏正文\n\n结束。';
  await page.evaluate(async ({ source, pluginSource }) => {
    document.body.classList.remove('tc-test-dark');
    const module = { exports: {} };
    class BasePlugin { constructor(name, config) { this.fixedName = name; this.config = config; this.utils = { entities: {} }; } }
    new Function('BasePlugin', 'module', pluginSource)(BasePlugin, module);
    window.calloutTestPlugin = new module.exports.plugin('callouts', { ENABLE: true });
    const write = document.querySelector('#write'), content = document.querySelector('#content');
    window.nativeCalloutOriginal = write.innerHTML;
    const getTheme = () => window.module.exports.readCanvasTheme({ write, content });
    const nativeCallouts = window.module.exports.createNativeCalloutRenderer({ write, plugin: window.calloutTestPlugin });
    write.classList.add('typewriter-mode');
    const probe = await nativeCallouts.render({ markdown: '> [!note] Short title\n> Short body', width: 650, pixelRatio: 2 });
    write.classList.remove('typewriter-mode');
    window.nativeProbe = { height: probe.height, width: probe.width, pixels: [probe.image.width, probe.image.height], nativeMinimum: getComputedStyle(write).minHeight };
    probe.image.width = probe.image.height = 0;
    window.pure = window.module.exports.mountCanvasEditor({ markdown: source, parent: content, embedded: true,
      theme: getTheme(), getTheme, themeNodes: [write, content], nativeCallouts });
    write.style.display = 'none';
  }, { source, pluginSource });
  const probe = await page.evaluate(() => window.nativeProbe);
  assert.equal(probe.nativeMinimum, '800px');
  assert.ok(probe.height < 200, `short Callout intrinsic height must exclude min-height:100vh (${JSON.stringify(probe)})`);
  assert.equal(probe.pixels[1], probe.height * 2);
  console.log('Native Callout geometry regression:', JSON.stringify(probe));
  await page.waitForFunction(() => window.pure.getStats().nativeCallouts.ready === 1 || window.pure.getStats().nativeCallouts.errors.length, null, { timeout: 12000 });
  let stats = await page.evaluate(() => window.pure.getStats());
  assert.deepEqual(stats.nativeCallouts.errors, []);
  assert.equal(stats.nativeCallouts.ready, 1);
  await page.waitForFunction(() => window.pure.getStats().nativeCallouts.drawnSlices >= 2);
  assert.ok((await page.evaluate(() => window.pure.getLineRect(8))).y < 400, 'Callout capture must not inherit the native editor viewport minimum height');
  assert.equal(await page.locator('[data-typora-canvas-callout-stage]').count(), 0);
  assert.equal(await page.locator('[data-typora-canvas-editor] blockquote').count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector('#write').innerHTML === window.nativeCalloutOriginal), true);
  assert.equal(await page.evaluate(() => Object.keys(window.calloutTestPlugin.utils.entities).length), 0, 'original plugin utilities are unchanged');
  const pixels = await page.locator('[data-typora-canvas-editor]').locator('canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0; for (let i = 0; i < data.length; i += 4) if (data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) dark++;
    return dark;
  });
  assert.ok(pixels > 1500, `native Callout must contain actual text pixels (${pixels})`);
  await page.screenshot({ path: 'test-output/callouts-native-plugin-light.png' });
  // A click expands source-backed Canvas editing; undo restores byte-exact text.
  const rect = await page.evaluate(() => window.pure.getLineRect(1));
  const host = page.locator('[data-typora-canvas-editor]'), main = await host.locator('main').boundingBox();
  await page.mouse.click(main.x + rect.x + 120, main.y + rect.y + 10);
  await page.keyboard.insertText('修改');
  assert.ok((await page.evaluate(() => window.pure.getText())).includes('修改'));
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.pure.getText()), source);
  await page.keyboard.press('Control+End');
  await page.waitForFunction(() => window.pure.getStats().nativeCallouts.drawnSlices >= 2);
  await page.evaluate(() => document.body.classList.add('native-dark'));
  await page.waitForFunction(() => window.pure.getStats().theme.background === 'rgb(18, 24, 32)' && window.pure.getStats().nativeCallouts.ready === 1);
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'test-output/callouts-native-plugin-dark.png' });
  await page.evaluate(() => document.body.classList.remove('native-dark'));
  await page.waitForFunction(() => window.pure.getStats().theme.background === 'rgb(255, 255, 255)' && window.pure.getStats().nativeCallouts.ready === 1);
  assert.equal(await page.evaluate(() => window.pure.getText()), source);
  await page.evaluate(() => { window.pure.destroy(); document.querySelector('#write').style.display = ''; });
  assert.equal(await page.locator('[data-typora-canvas-callout-stage]').count(), 0);
  // More visible blocks than the cache budget must settle without eviction loops.
  await page.evaluate(() => {
    window.nativeCaptures = 0;
    const bridge = window.module.exports.createNativeCalloutRenderer({ write: document.querySelector('#write'), plugin: window.calloutTestPlugin });
    const render = bridge.render; bridge.render = request => { window.nativeCaptures++; return render(request); };
    window.pure = window.module.exports.mountCanvasEditor({
      markdown: Array.from({ length: 12 }, (_, i) => `> [!note] Note ${i}`).join('\n\n'), nativeCallouts: bridge });
  });
  await page.waitForFunction(() => window.pure.getStats().nativeCallouts.ready === 8, null, { timeout: 12000 });
  await page.waitForTimeout(200);
  const captures = await page.evaluate(() => window.nativeCaptures);
  await page.evaluate(() => window.pure.host.shadowRoot.querySelector('.scroll').dispatchEvent(new Event('scroll')));
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.nativeCaptures), captures);
  assert.ok((await page.evaluate(() => window.pure.getStats())).nativeCallouts.bytes <= 32 * 1024 * 1024);
  await page.evaluate(() => window.pure.destroy());
}
