import assert from 'node:assert/strict';

export async function testQuoteEnter(page) {
  const cases = [
    { source: '> a', pos: 3, expected: '> a\n> ', head: 6 },
    { source: '> ab', pos: 3, expected: '> a\n> b', head: 6 },
    { source: '> ', pos: 2, expected: '', head: 0 },
    { source: '>', pos: 1, expected: '', head: 0 },
    { source: '> [!note] Title\n> Last', pos: 22, expected: '> [!note] Title\n> Last\n> ', head: 25 },
    { source: '> [!note] Title\n> ab\nAfter', pos: 19, expected: '> [!note] Title\n> a\n> b\nAfter', head: 22 },
    { source: '> [!note] Title\n> ', pos: 18, expected: '> [!note] Title\n', head: 16 },
    { source: '> [!note] Title', pos: 0, expected: '\n> [!note] Title', head: 1 },
    { source: '> > ab', pos: 5, expected: '> > a\n> > b', head: 10 },
    { source: '> > ', pos: 4, expected: '> ', head: 2 },
  ];
  for (const native of [false, true]) for (const item of cases) {
    await page.evaluate(({ source, pos, native }) => {
      const write = document.querySelector('#write');
      const nativeCallouts = native ? window.module.exports.createNativeCalloutRenderer({ write, plugin: window.calloutTestPlugin }) : null;
      window.pure = window.module.exports.mountCanvasEditor({ markdown: source, nativeCallouts });
      window.pure.model.select(pos);
    }, { ...item, native });
    // Home followed by right arrows synchronizes the real input and selection.
    await page.keyboard.press('Home');
    const local = item.pos - (item.source.lastIndexOf('\n', item.pos - 1) + 1);
    for (let i = 0; i < local; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.pure.getText()), item.expected, `${JSON.stringify(item)} native=${native}`);
    assert.equal(await page.evaluate(() => window.pure.getStats().selection.head), item.head);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.pure.getText()), item.source);
    await page.keyboard.press('Control+y');
    assert.equal(await page.evaluate(() => window.pure.getText()), item.expected);
    await page.evaluate(() => window.pure.destroy());
  }
  // A second Enter on the newly continued empty line exits the Callout.
  await page.evaluate(() => { window.pure = window.module.exports.mountCanvasEditor({ markdown: '> [!note] Title\n> Last' }); });
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.pure.getText()), '> [!note] Title\n> Last\n');
  await page.keyboard.insertText('Outside');
  assert.equal(await page.evaluate(() => window.pure.getText()), '> [!note] Title\n> Last\nOutside');
  await page.evaluate(() => window.pure.destroy());
  console.log('Quote Enter: continuation, splitting, empty-line exit, nested prefixes and undo/redo passed');
}
