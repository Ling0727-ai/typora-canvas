import assert from 'node:assert/strict';

export async function testTableArrows(page) {
  const table = '| Head | Other |\n| --- | --- |\n| abc | de |\n| f | gh |';
  for (const prefix of ['', '> ']) {
    const source = 'Before\n\n' + (prefix ? '> [!note] Table\n' : '') + table.split('\n').map(s => prefix + s).join('\n') + '\n\nAfter';
    await page.evaluate(source => { window.pure = window.module.exports.mountCanvasEditor({ markdown: source }); }, source);
    const select = async pos => {
      await page.evaluate(pos => window.pure.model.select(pos), pos);
      await page.keyboard.press('Home');
      await page.evaluate(pos => window.pure.model.select(pos), pos);
    };
    const head = () => page.evaluate(() => window.pure.getStats().selection.head);
    await select(source.indexOf('abc') + 1);
    await page.keyboard.press('ArrowUp'); assert.equal(await head(), source.indexOf('Head') + 1);
    await page.keyboard.press('ArrowDown'); assert.equal(await head(), source.indexOf('abc') + 1);
    await page.keyboard.press('ArrowDown'); assert.equal(await head(), source.indexOf('| f') + 3);
    await page.keyboard.press('ArrowDown'); assert.equal(await head(), source.indexOf('\n\nAfter') + 1);
    await select(source.indexOf('Head'));
    await page.keyboard.press('ArrowLeft'); assert.equal(await head(), prefix ? source.indexOf('\n', source.indexOf('[!note]')) : source.indexOf('\n\n') + 1);
    await select(source.indexOf('Head'));
    await page.keyboard.press('ArrowUp'); assert.equal(await head(), prefix ? source.indexOf('\n', source.indexOf('[!note]')) : source.indexOf('\n\n') + 1);
    await select(source.indexOf('abc'));
    await page.keyboard.press('ArrowLeft'); assert.equal(await head(), source.indexOf('Other') + 5);
    await select(source.indexOf('de |') + 2);
    await page.keyboard.press('ArrowRight'); assert.equal(await head(), source.indexOf('| f') + 2);
    await select(source.indexOf('gh') + 2);
    await page.keyboard.press('ArrowRight'); assert.equal(await head(), source.indexOf('\n\nAfter') + 1);
    assert.equal(await page.evaluate(() => window.pure.getText()), source, 'navigation does not modify existing paragraphs or table rows');
    await page.evaluate(() => window.pure.destroy());
  }
  // At document boundaries create an editable paragraph instead of trapping
  // the caret in the first or last table cell. These edits remain undoable.
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    await page.evaluate(table => { window.pure = window.module.exports.mountCanvasEditor({ markdown: table }); }, table);
    const before = ['ArrowUp', 'ArrowLeft'].includes(key);
    await page.keyboard.press(before ? 'Control+Home' : 'Control+End');
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => window.pure.getText()), before ? '\n' + table : table + '\n');
    assert.equal(await page.evaluate(() => window.pure.getStats().table), null);
    await page.keyboard.insertText('Outside');
    assert.equal(await page.evaluate(() => window.pure.getText()), before ? 'Outside\n' + table : table + '\nOutside');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.pure.getText()), table);
    await page.evaluate(() => window.pure.destroy());
  }
  console.log('Table arrows: cell transitions, separator skipping, existing paragraphs and document-boundary exit passed');
}
