import assert from 'node:assert/strict';

export async function testNavigation(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const source = '# 开始\n\n[网站](https://example.com/a(b)) [文档](<notes/my file.md#标题>) [跳转](#目标章节)\n\n' +
    Array.from({ length: 200 }, (_, i) => `正文第 ${i + 1} 行。`).join('\n') + '\n\n## 目标章节\n\n' +
    Array.from({ length: 100 }, (_, i) => `后半部分第 ${i + 1} 行。`).join('\n');
  await page.evaluate(markdown => {
    const panel = document.createElement('ul'); panel.id = 'outline-content'; panel.className = 'outline-content';
    panel.style.cssText = 'position:fixed;left:0;top:120px;width:190px;z-index:20;background:white;color:black'; document.body.append(panel);
    window.nativeOutlineClicks = 0; window.nativeOutlineUpdates = 0; window.openedLinks = [];
    // The native renderer consumes only cid/isDeleted/get(depth,text), matching
    // the Typora 1.14 outline contract. Its own full-document toc stays stale.
    window.testOutline = {
      updateOutlineHtml(toc) {
        window.nativeOutlineUpdates++;
        panel.replaceChildren(...toc.headers.map(h => {
          const li = document.createElement('li'); li.className = `outline-item-wrapper outline-h${h.get('depth')}`;
          const item = document.createElement('div'); item.className = 'outline-item';
          const expander = document.createElement('span'); expander.className = 'outline-expander'; expander.textContent = '▸';
          const label = document.createElement('span'); label.className = 'outline-label'; label.dataset.ref = h.cid; label.textContent = h.get('text');
          item.append(expander, label); li.append(item); return li;
        }));
      },
      getHeaderMatrix: () => [[1, 'Stale native heading', 'native1']],
      highlightVisibleHeader() {}, renderOutline() { panel.textContent = 'Native outline restored'; }, autoHideOutline() {}, onEnterKey() { throw new Error('Stale native keyboard navigation'); }
    };
    window.nativeOutlineOriginals = Object.fromEntries(Object.entries(window.testOutline));
    window.nativeOutlineClick = e => { if (e.target.closest('.outline-item')) window.nativeOutlineClicks++; };
    document.addEventListener('click', window.nativeOutlineClick);
    window.pure = window.module.exports.mountCanvasEditor({ markdown, parent: document.querySelector('#content'), embedded: true,
      onChange: () => window.navigation.refresh(), onViewportChange: () => window.navigation?.highlight(),
      onOpenLink: href => window.navigation.open(href) });
    window.navigation = window.module.exports.attachCanvasNavigation({ editor: window.pure, outline: window.testOutline, openLink: href => window.openedLinks.push(href) });
  }, source);
  await page.waitForFunction(() => window.pure.getStats().drawnLines > 0);
  const host = page.locator('[data-typora-canvas-editor]'), scroll = host.locator('.scroll');
  const scrollbar = await scroll.evaluate(el => ({ gutter: el.offsetWidth - el.clientWidth, overflow: getComputedStyle(el).overflowY,
    thumb: getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor }));
  assert.equal(scrollbar.gutter, 12); assert.equal(scrollbar.overflow, 'scroll');
  assert.notEqual(scrollbar.thumb, 'rgba(0, 0, 0, 0)');
  const geometry = await scroll.boundingBox(), canvas = await host.locator('canvas').boundingBox();
  assert.equal(canvas.width, geometry.width - 12, 'Canvas must stop before the scrollbar');
  // Clicking the scrollbar trough must page down instead of placing a caret.
  const selection = await page.evaluate(() => window.pure.getStats().selection);
  await page.mouse.click(geometry.x + geometry.width - 6, geometry.y + geometry.height * .6);
  await page.waitForFunction(() => window.pure.getStats().scrollTop > 0, null, { timeout: 2000 });
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.pure.getStats().selection), selection);
  await page.locator('#outline-content .outline-label').filter({ hasText: '目标章节' }).click();
  await page.waitForFunction(() => Math.abs(window.pure.getLineRect(window.pure.getOutline()[1].line).y) < 2);
  assert.equal(await page.evaluate(() => window.nativeOutlineClicks), 0, 'Canvas outline clicks must not reach stale native nodes');
  assert.equal(await page.locator('#outline-content .outline-label.outline-active').textContent(), '目标章节');
  assert.deepEqual(await page.evaluate(() => window.testOutline.getHeaderMatrix(true).map(row => row.slice(0, 2))), [[1, '开始'], [2, '目标章节']]);
  await page.locator('#outline-content .outline-label').filter({ hasText: '开始' }).click();
  await page.waitForFunction(() => window.pure.getStats().scrollTop === 0);
  await page.waitForTimeout(80);
  const main = await host.locator('main').boundingBox(), line = await page.evaluate(() => window.pure.getLineRect(2));
  const linkPoint = await page.evaluate(() => {
    const ctx = window.pure.host.shadowRoot.querySelector('canvas').getContext('2d');
    const font = window.pure.getStats().theme.font; ctx.font = `400 17px ${font}`;
    return { web: ctx.measureText('网站').width / 2, local: ctx.measureText('网站 ').width + ctx.measureText('文档').width / 2,
      anchor: ctx.measureText('网站 文档 ').width + ctx.measureText('跳转').width / 2 };
  });
  await page.keyboard.down('Control');
  await page.mouse.click(main.x + line.x + linkPoint.web, main.y + line.y + 18);
  await page.mouse.click(main.x + line.x + linkPoint.local, main.y + line.y + 18);
  await page.mouse.click(main.x + line.x + linkPoint.anchor, main.y + line.y + 18);
  await page.keyboard.up('Control');
  await page.waitForFunction(() => window.openedLinks.length === 2, null, { timeout: 2000 });
  assert.deepEqual(await page.evaluate(() => window.openedLinks), ['https://example.com/a(b)', 'notes/my file.md#标题']);
  await page.waitForFunction(() => Math.abs(window.pure.getLineRect(window.pure.getOutline()[1].line).y) < 2);
  assert.equal(await page.evaluate(() => window.pure.getText()), source, 'navigation must not edit the document');
  await page.evaluate(() => {
    document.querySelector('#outline-content .outline-item').classList.add('select');
    window.testOutline.onEnterKey({ preventDefault() {} });
  });
  await page.waitForFunction(() => window.pure.getStats().scrollTop === 0);
  // Heading edits update the existing panel without parsing a hidden document.
  await host.locator('textarea').focus(); await page.keyboard.press('Control+Home'); await page.keyboard.press('End');
  await page.keyboard.insertText('修改');
  await page.locator('#outline-content .outline-label').filter({ hasText: '开始修改' }).waitFor();
  await page.keyboard.press('Control+z');
  await page.locator('#outline-content .outline-label').filter({ hasText: '开始' }).waitFor();
  assert.equal(await page.evaluate(() => window.pure.getText()), source);
  await page.screenshot({ path: 'test-output/canvas-navigation.png' });
  await page.evaluate(() => {
    window.navigation.detach(); window.pure.destroy();
    document.removeEventListener('click', window.nativeOutlineClick);
    window.navigationRestored = Object.entries(window.nativeOutlineOriginals).every(([key, value]) => window.testOutline[key] === value);
    document.querySelector('#outline-content').remove();
  });
  assert.equal(await page.evaluate(() => window.navigationRestored), true);
}
