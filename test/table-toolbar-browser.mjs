import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';

function shape(source) {
  const rows = classifyLines(new CanvasDocument(source).doc), header = rows.find(r => r.type === 'table');
  return header ? { rows: header.tableEnd - header.tableStart, columns: header.columns } : null;
}
export async function testTableToolbar(page) {
  const original = '# Before\n\n| Name | Math |\n| --- | :---: |\n| A | $\\alpha$ |\n| B | C |\n\nAfter';
  await page.evaluate(source => { window.pure = window.module.exports.mountCanvasEditor({ markdown: source }); }, original);
  const host = page.locator('[data-typora-canvas-editor]');
  await page.waitForFunction(() => window.pure.getStats().drawnTables === 3);
  const toolbar = host.getByRole('toolbar', { name: '表格工具' });
  assert.equal(await toolbar.isVisible(), false);
  const clickCell = async (line, column, columns) => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const rect = await page.evaluate(i => window.pure.getLineRect(i), line);
    const main = await host.locator('main').boundingBox();
    await page.mouse.click(main.x + rect.x + column * rect.width / columns + 10, main.y + rect.y + 12);
    await toolbar.waitFor({ state: 'visible' });
    await page.waitForTimeout(30);
    assert.equal((await page.evaluate(() => window.pure.getStats())).table.column, column);
  };
  const text = () => page.evaluate(() => window.pure.getText());
  const menu = async name => {
    await toolbar.getByRole('button', { name: '更多表格操作', exact: true }).click();
    await host.getByRole('menuitem', { name, exact: true }).click();
  };
  await clickCell(4, 0, 2);
  assert.equal((await page.evaluate(() => window.pure.getStats())).table.row, 1);
  await toolbar.getByRole('button', { name: '列右对齐', exact: true }).click();
  assert.ok((await text()).includes('| ---: | :---: |'));
  await page.waitForFunction(() => document.querySelector('[data-typora-canvas-editor]').shadowRoot.querySelector('[data-command="right"]').getAttribute('aria-pressed') === 'true');
  assert.equal(await toolbar.getByRole('button', { name: '列右对齐', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Control+z'); assert.equal(await text(), original);
  for (const key of ['Alt+ArrowDown', 'Alt+ArrowRight']) {
    await page.keyboard.press(key); assert.notEqual(await text(), original);
    await page.keyboard.press('Control+z'); assert.equal(await text(), original);
  }
  await page.keyboard.press('Alt+ArrowDown'); const movedDown = await text();
  await page.keyboard.press('Alt+ArrowUp'); assert.equal(await text(), original.replace('| --- |', '| :--- |'));
  await page.keyboard.press('Control+z'); assert.equal(await text(), movedDown);
  await page.keyboard.press('Control+z'); assert.equal(await text(), original);
  await page.keyboard.press('Alt+ArrowRight'); const movedRight = await text();
  await page.keyboard.press('Alt+ArrowLeft'); assert.equal(await text(), original.replace('| --- |', '| :--- |'));
  await page.keyboard.press('Control+z'); assert.equal(await text(), movedRight);
  await page.keyboard.press('Control+z'); assert.equal(await text(), original);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await menu('复制表格');
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), original.split('\n').slice(2, 6).join('\n'));
  await menu('格式化表格源码'); const formatted = await text();
  assert.ok(formatted.includes('$\\alpha$')); assert.ok(formatted.endsWith('\n\nAfter'));
  await page.keyboard.press('Control+z'); assert.equal(await text(), original);

  await toolbar.getByRole('button', { name: '调整表格行列', exact: true }).click();
  const rowInput = host.getByRole('spinbutton', { name: '表格行数（含表头）' });
  await rowInput.focus(); await page.keyboard.press('Control+a'); await page.keyboard.type('4');
  await host.getByRole('spinbutton', { name: '表格列数', exact: true }).fill('3');
  assert.equal(await text(), original, 'editing resize inputs must not edit the document');
  await host.getByRole('button', { name: '应用行列数', exact: true }).click();
  assert.deepEqual(shape(await text()), { rows: 4, columns: 3 });
  const resized = await text(); assert.ok(resized.includes('$\\alpha$'));
  await menu('在右侧插入列'); assert.deepEqual(shape(await text()), { rows: 4, columns: 4 });
  await menu('删除当前列'); assert.deepEqual(shape(await text()), { rows: 4, columns: 3 });
  await page.keyboard.press('Control+z'); assert.deepEqual(shape(await text()), { rows: 4, columns: 4 });
  await page.keyboard.press('Control+z'); assert.equal(await text(), resized);
  await menu('在下方插入行'); assert.deepEqual(shape(await text()), { rows: 5, columns: 3 });
  await menu('删除当前行'); assert.equal(await text(), resized);

  // Tab from the final cell inserts a row; Shift+Tab returns to the prior cell.
  await clickCell(6, 2, 3);
  assert.equal((await page.evaluate(() => window.pure.getStats())).table.row, 3);
  await page.keyboard.press('Tab'); assert.deepEqual(shape(await text()), { rows: 5, columns: 3 });
  await page.keyboard.press('Shift+Tab'); await page.keyboard.insertText('last');
  assert.ok((await text()).includes('last'));
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  assert.equal(await text(), resized);
  await page.keyboard.press('Control+Enter');
  assert.deepEqual(shape(await text()), { rows: 5, columns: 3 });
  await page.keyboard.press('Control+z'); assert.equal(await text(), resized);
  await page.keyboard.press('Control+Shift+Enter');
  await toolbar.waitFor({ state: 'hidden' });
  await page.keyboard.insertText('Outside'); assert.ok((await text()).includes('Outside'));
  await page.keyboard.press('Control+z'); assert.equal(await text(), resized);
  await clickCell(4, 0, 3);
  await page.screenshot({ path: 'test-output/table-toolbar.png', caret: 'initial' });
  await toolbar.getByRole('button', { name: '删除表格', exact: true }).click();
  assert.equal(shape(await text()), null); assert.ok((await text()).includes('After'));
  await page.keyboard.press('Control+z'); assert.equal(await text(), resized);
  await page.evaluate(() => window.pure.destroy());
}
