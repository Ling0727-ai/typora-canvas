import assert from 'node:assert/strict';

export async function testBlocksAndTheme(page) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(() => { document.body.className = ''; });
  await page.addStyleTag({ content: `
    body{--bg-color:#fff;--text-color:#171717;background:var(--bg-color)!important;color:var(--text-color)!important}
    body.block-dark{--bg-color:#18202b;--text-color:#edf2fa}
    #write{font:18px/1.6 Arial,sans-serif;color:var(--text-color);background:var(--bg-color)!important;transition:background-color .18s;color:var(--text-color);padding:16px 24px}
    #content{background:var(--bg-color)!important;transition:background-color .18s}
    #write h1{font-size:36px;line-height:45px;color:#00468c;margin:12px 0 18px}
    #write h2{font-size:28px;line-height:38px;color:#0066a0;margin:18px 0 12px}
    body.block-dark #write h1,body.block-dark #write h2{color:#88b5ff}
    #write p{margin:12px 0}#write hr{border:0;border-top:2px solid #adbacb;margin:12px 0}
    #write table{background:transparent;border-collapse:collapse}#write th,#write td{padding:6px 10px;border:1px solid #aec0d0;color:var(--text-color)}
    #write th{background:#dceaf6}#write tbody tr:nth-child(odd){background:#fff}#write tbody tr:nth-child(even){background:#edf2f7}
    body.block-dark #write th{background:#293d53}body.block-dark #write tbody tr:nth-child(odd){background:#18202b}body.block-dark #write tbody tr:nth-child(even){background:#202d3d}
    #write .md-fences{background:#f1f3f7;margin:10px 0}body.block-dark #write .md-fences{background:#243040}
    #write .CodeMirror{font:16px/24px Consolas,monospace}#write .CodeMirror-line{margin:0;font:inherit}
    #write .cm-keyword{color:#b12483}body.block-dark #write .cm-keyword{color:#e09ed2}
    #write .cm-number{color:#116fa2}` });
  const source = '# 第一章 绪论\n\n\n\n## 机械设计研究什么\n\n$$\\sigma_m=\\frac{a+b}{2},\\qquad\n\\sigma_a=\\frac{a-b}{2}$$\n\n---\n\n___\n\n```c\nint main() {\n  return 21;\n}\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
  await page.evaluate(source => {
    const write = document.querySelector('#write'), content = document.querySelector('#content'); write.style.display = 'none';
    const getTheme = () => window.module.exports.readCanvasTheme({ write, content });
    window.pure = window.module.exports.mountCanvasEditor({ markdown: source, parent: content, embedded: true, theme: getTheme(), getTheme, themeNodes: [write, content] });
  }, source);
  await page.waitForFunction(() => window.pure.getStats().highlightedCodeLines >= 2 && window.pure.getStats().previewFormulas === 1 && window.pure.getStats().drawnTables === 3);
  let stats = await page.evaluate(() => window.pure.getStats());
  assert.equal(stats.typography.headings[0].color, 'rgb(0, 70, 140)');
  assert.equal(stats.typography.headings[0].fontSize, 36);
  assert.equal(stats.codeTheme.tokenColors.keyword, 'rgb(177, 36, 131)');
  for (let i = 1; i <= 3; i++) assert.ok((await page.evaluate(i => window.pure.getLineRect(i).height, i)) < .1);
  const canvas = page.locator('[data-typora-canvas-editor]').locator('canvas');
  await page.screenshot({ path: 'test-output/blocks-theme-light.png' });
  const pixel = async (line, expected) => {
    // Theme state changes before asynchronous formula decode/layout/paint.
    // Read geometry and pixels in the same task, waiting for actual paint.
    await page.waitForFunction(({ line, expected }) => {
      const rect = window.pure.getLineRect(line), el = window.pure.host.shadowRoot.querySelector('canvas');
      const actual = [...el.getContext('2d').getImageData(Math.round(rect.x + rect.width - 15), Math.round(rect.y + rect.height - 5), 1, 1).data];
      return actual.every((value, i) => value === [...expected, 255][i]);
    }, { line, expected }, { timeout: 5000 });
  };
  await pixel(19, [220, 234, 246]); await pixel(22, [237, 242, 247]);
  await page.screenshot({ path: 'test-output/blocks-theme-light.png' });
  // One class switch starts CSS transitions; a later stylesheet finishes loading.
  await page.evaluate(() => document.body.classList.add('block-dark'));
  await page.waitForFunction(() => window.pure.getStats().theme.background === 'rgb(24, 32, 43)' && window.pure.getStats().tableTheme.headerBackground === 'rgb(41, 61, 83)');
  await page.waitForTimeout(60); await pixel(19, [41, 61, 83]); await pixel(22, [32, 45, 61]);
  await page.evaluate(() => document.body.classList.remove('block-dark'));
  await page.waitForFunction(() => window.pure.getStats().theme.background === 'rgb(255, 255, 255)' && window.pure.getStats().tableTheme.headerBackground === 'rgb(220, 234, 246)');
  await page.waitForTimeout(60); await pixel(19, [220, 234, 246]);
  assert.equal(await page.evaluate(() => window.pure.getText()), source);
  // The language control edits only the fence info and remains undoable.
  const host = page.locator('[data-typora-canvas-editor]'), main = await host.locator('main').boundingBox();
  const code = await page.evaluate(() => window.pure.getLineRect(14));
  await page.mouse.click(main.x + code.x + 60, main.y + code.y + 10);
  await host.getByRole('button', { name: '代码块语言', exact: true }).click();
  await host.getByRole('textbox', { name: '筛选代码语言' }).fill('python');
  await host.getByRole('option', { name: 'Pythonpython', exact: true }).click();
  assert.equal(await page.evaluate(() => window.pure.getText()), source.replace('```c', '```python'));
  await page.keyboard.press('Control+z'); assert.equal(await page.evaluate(() => window.pure.getText()), source);
  await page.evaluate(() => window.pure.destroy());
  // Automatic suggestions while entering a fence, including C/C#/C++.
  await page.evaluate(() => { window.pure = window.module.exports.mountCanvasEditor({ markdown: '```\n\n```' }); });
  await page.keyboard.press('End'); await page.keyboard.insertText('c');
  await host.getByRole('listbox', { name: '代码语言建议' }).waitFor({ state: 'visible' });
  assert.ok(await host.getByRole('option', { name: /^C\+\+/ }).count());
  await page.keyboard.press('Enter');
  assert.equal((await page.evaluate(() => window.pure.getStats())).selection.head, 5);
  await page.keyboard.insertText('int x = 21;');
  await page.waitForFunction(() => window.pure.getStats().highlightedCodeLines > 0);
  assert.equal(await page.evaluate(() => window.pure.getText()), '```c\nint x = 21;\n```');
  await page.evaluate(() => { window.pure.destroy(); document.querySelector('#write').style.display = ''; });
}
