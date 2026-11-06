import assert from 'node:assert/strict';

export async function testLists(page) {
  await page.setViewportSize({ width: 1050, height: 1000 });
  await page.addStyleTag({ content: `body.list-test #write{font:18px/28px Arial;color:#222;padding:0}
    body.list-test #write ul{padding-left:42px;margin:10px 0;list-style-type:disc}
    body.list-test #write ol{padding-left:54px;margin:10px 0;list-style-type:lower-alpha}
    body.list-test #write ul ul{padding-left:30px;list-style-type:circle;margin:0}
    body.list-test #write li{font:18px/28px Arial;color:#222;margin:0;padding:0}
    body.list-test #write li::marker{color:rgb(200,40,50)}
    body.list-blue #write li::marker{color:rgb(30,90,210)}` });
  const source = ['Intro', '', '- **First** $x$ ' + 'long content wraps and aligns '.repeat(7),
    '  - Nested bullet', '    continuation text', '  1. Mixed ordered', '- Last bullet', '',
    '7. Seventh', '1. Eighth', '', 'After'].join('\n');
  await page.evaluate(source => {
    document.body.classList.add('list-test');
    const write = document.querySelector('#write'); write.style.display = '';
    const getTheme = () => window.module.exports.readCanvasTheme({ write, content: document.querySelector('#content') });
    window.pure = window.module.exports.mountCanvasEditor({ markdown: source, theme: getTheme(), getTheme, themeNodes: [write] });
  }, source);
  await page.waitForFunction(() => window.pure.getStats().previewFormulas === 1);
  const theme = await page.evaluate(() => window.pure.getStats().typography.lists);
  assert.equal(theme.ul.paddingLeft, 42); assert.equal(theme['ul/ul'].paddingLeft, 30);
  assert.equal(theme.ol.listStyleType, 'lower-alpha'); assert.equal(theme.ul.item.lineHeight, 28);
  const ink = async line => page.evaluate(line => {
    const rect = window.pure.getLineRect(line), canvas = window.pure.host.shadowRoot.querySelector('canvas');
    const pixels = canvas.getContext('2d').getImageData(0, Math.floor(rect.y), canvas.width, Math.ceil(rect.height));
    const rows = new Map(); let markerX = Infinity, markerCount = 0;
    for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
      const i = (y * pixels.width + x) * 4, r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
      if (r > 140 && g < 100 && b < 110) { markerX = Math.min(markerX, x); markerCount++; }
      if (r < 90 && g < 90 && b < 90 && x >= rect.x) rows.set(y, Math.min(rows.get(y) ?? Infinity, x));
    }
    return { markerX, markerCount, rows: [...rows], rect };
  }, line);
  const first = await ink(2), nested = await ink(3), continuation = await ink(4), ordered = await ink(8);
  assert.ok(first.markerCount > 0 && nested.markerCount > 0 && ordered.markerCount > 0,
    JSON.stringify([first.markerCount, nested.markerCount, ordered.markerCount]));
  assert.ok(nested.markerX > first.markerX + 20, JSON.stringify({ first, nested }));
  assert.equal(continuation.markerCount, 0);
  assert.ok(Math.min(...continuation.rows.map(([, x]) => x)) >= continuation.rect.x + 72);
  // Wrapped content starts at the hanging indent, including after the first
  // visual line; the gutter contains only one marker per logical item.
  const wrapped = first.rows.filter(([y]) => y > 45);
  assert.ok(wrapped.length > 0); assert.ok(wrapped.every(([, x]) => x >= first.rect.x + 42));
  await page.screenshot({ path: 'test-output/lists-theme.png' });
  const host = page.locator('[data-typora-canvas-editor]');
  await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  const start = source.indexOf('- **First**') + 2;
  assert.equal(await page.evaluate(() => window.pure.getStats().selection.head), start);
  await page.keyboard.insertText('Edited ');
  assert.equal(await page.evaluate(() => window.pure.getText()), source.slice(0, start) + 'Edited ' + source.slice(start));
  const rebuilds = await page.evaluate(() => window.pure.getStats().structureRebuilds);
  await page.keyboard.insertText('body');
  assert.equal(await page.evaluate(() => window.pure.getStats().structureRebuilds), rebuilds, 'ordinary list typing does not reparse the full document');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z'); assert.equal(await page.evaluate(() => window.pure.getText()), source);
  await page.keyboard.press('Control+End');
  await page.evaluate(() => document.body.classList.add('list-blue'));
  await page.waitForFunction(() => window.pure.getStats().typography.lists.ul.marker.color === 'rgb(30, 90, 210)');
  await page.waitForFunction(() => {
    const r = window.pure.getLineRect(8), canvas = window.pure.host.shadowRoot.querySelector('canvas');
    const data = canvas.getContext('2d').getImageData(Math.floor(r.x), Math.floor(r.y), 72, Math.ceil(r.height)).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 80 && data[i + 1] < 130 && data[i + 2] > 160) return true;
    return false;
  });
  await page.screenshot({ path: 'test-output/lists-theme-blue.png' });
  await page.evaluate(() => { window.pure.destroy(); document.body.classList.remove('list-test', 'list-blue'); });
  assert.equal(await host.count(), 0);
  console.log('Lists: theme markers/indent, mixed nesting, continuation, hanging wraps, math, editing/undo and theme change passed');
}
