import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

export async function testCalloutsAndTheme(page) {
  const palette = JSON.parse(await readFile('src/callout-defaults.json', 'utf8')).types;
  const typeCss = Object.entries(palette).map(([type, spec]) => `#write .plugin-callout[callout-type="${type}"]{--obs-callout-rgb:var(--obs-${type}-rgb,${spec.color.slice(4, -1)});--obs-callout-icon:url("${spec.iconUrl}")}`).join('\n');
  await page.addStyleTag({ content: `body{--bg-color:#ffffff;--text-color:#243044;--obs-definition-rgb:27,110,74;background:var(--bg-color)!important;color:var(--text-color)!important}
    body.tc-test-dark{--bg-color:#18202b;--text-color:#e7edf6;--obs-definition-rgb:118,205,162}
    #content{background:var(--bg-color)!important}#write{color:var(--text-color);background:transparent!important;font-size:17px}
    #write .plugin-callout{background:transparent;border:0;border-left:2px solid rgba(var(--obs-callout-rgb),.7);padding:2px 0 2px 14px;margin:20px 0}
    #write .plugin-callout span[data-type]::after{font-size:17px;color:rgb(var(--obs-callout-rgb))}
    #write .plugin-callout>p:first-child::before{content:"";display:inline-block;width:17px;height:17px;mask:var(--obs-callout-icon)}
    ${typeCss}` });
  const source = '> [!definition] 定义与 $\\alpha$\n> 正文保持普通颜色。\n>\n> | 项目 | 公式 |\n> | --- | --- |\n> | 应力 | $\\sigma_{\\max}$ |\n>\n> > [!proof]+ 证明\n> > a $\\frac{1}{2}$ b\n\n> [!warning]- 折叠标题\n> 折叠正文\n\n> [!notes] 旧别名\n> 普通内容';
  await page.evaluate(source => {
    const write = document.querySelector('#write'), content = document.querySelector('#content');
    write.style.display = 'none';
    const getTheme = () => window.module.exports.readCanvasTheme({ write, content, calloutConfig: { HOVER_TO_SHOW_FOLD_CALLOUT: true } });
    window.pure = window.module.exports.mountCanvasEditor({ markdown: source, parent: content, embedded: true, theme: getTheme(), getTheme });
  }, source);
  await page.waitForFunction(() => window.pure.getStats().calloutGroups === 4 && window.pure.getStats().readyAssets >= 5, null, { timeout: 5000 });
  assert.equal(await page.locator('[data-typora-canvas-editor] blockquote').count(), 0);
  assert.equal(await page.evaluate(() => window.pure.getText()), source);
  assert.equal((await page.evaluate(() => window.pure.getStats())).hiddenCalloutLines, 1);
  const warningLine = source.split('\n').findIndex(line => line.includes('[!warning]'));
  await page.evaluate(i => window.pure.scrollToLine(i), warningLine);
  await page.waitForTimeout(80);
  const main = await page.locator('[data-typora-canvas-editor]').locator('main').boundingBox();
  const warningRect = await page.evaluate(i => window.pure.getLineRect(i), warningLine);
  await page.mouse.move(main.x + warningRect.x + 10, main.y + warningRect.y + 25);
  await page.waitForFunction(() => window.pure.getStats().hiddenCalloutLines === 0, null, { timeout: 5000 });
  await page.mouse.move(10, 10);
  await page.waitForFunction(() => window.pure.getStats().hiddenCalloutLines === 1);
  await page.evaluate(() => window.pure.scrollToLine(0));
  await page.waitForTimeout(80);
  assert.equal((await page.evaluate(() => window.pure.getStats())).theme.background, 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-output/callouts-light.png', caret: 'initial' });
  await page.evaluate(() => document.body.classList.add('tc-test-dark'));
  await page.waitForFunction(() => window.pure.getStats().theme.background === 'rgb(24, 32, 43)' && window.pure.getStats().readyAssets >= 5);
  await page.waitForTimeout(80);
  const canvas = page.locator('[data-typora-canvas-editor]').locator('canvas');
  const darkPixel = await canvas.evaluate(el => [...el.getContext('2d').getImageData(el.width - 10, 10, 1, 1).data]);
  assert.deepEqual(darkPixel, [24, 32, 43, 255]);
  await page.screenshot({ path: 'test-output/callouts-dark.png', caret: 'initial' });
  assert.equal(await page.evaluate(() => window.pure.getText()), source);
  const darkCallouts = await page.evaluate(() => window.module.exports.readCalloutTheme({ write: document.querySelector('#write') }).types.definition);
  assert.equal(darkCallouts.color.replace(/\s/g, ''), 'rgb(118,205,162)');
  await page.addStyleTag({ content: 'body.tc-test-dark{--bg-color:#000000;--text-color:#ffffff}' });
  await page.waitForFunction(() => window.pure.getStats().theme.background === 'rgb(0, 0, 0)');
  await page.waitForTimeout(50);
  const blackPixel = await canvas.evaluate(el => [...el.getContext('2d').getImageData(el.width - 10, 10, 1, 1).data]);
  assert.deepEqual(blackPixel, [0, 0, 0, 255]);
  await page.evaluate(() => { window.pure.destroy(); document.querySelector('#write').style.display = ''; });
}
