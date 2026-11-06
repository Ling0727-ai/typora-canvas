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
  const cases = [
    ['1. a\n2. b\n3. c', 9, '1. a\n2. b\n3. \n4. c'],
    ['1. a', 4, '1. a\n2. '], ['1. a\n2.', 7, '1. a\n'],
    ['- ab', 3, '- a\n- b'], ['* a\n* ', 6, '* a\n'],
    ['(1) a', 5, '(1) a\n(2) '], ['a. a\nb. b', 9, 'a. a\nb. b\nc. '],
    ['i. a\nii. b', 10, 'i. a\nii. b\niii. '], ['I. a\nII. b', 10, 'I. a\nII. b\nIII. '],
    ['- Outer\n  1. a\n  2. b\n- Last', 14, '- Outer\n  1. a\n  2. \n  3. b\n- Last'],
    ['- > [!note] Title', 17, '- > [!note] Title\n  > '],
    ['> - Item\n>   continuation', 25, '> - Item\n>   continuation\n> - '],
    ['> [!note] Title\n> 1. Parent\n>    - Child\n>      (1) Deep\n>      (2) Next', 56,
      '> [!note] Title\n> 1. Parent\n>    - Child\n>      (1) Deep\n>      (2) \n>      (3) Next'],
  ];
  for (const [source, position, expected] of cases) {
    await page.evaluate(({ source, position }) => {
      window.pure = window.module.exports.mountCanvasEditor({ markdown: source }); window.pure.model.select(position);
    }, { source, position });
    await page.keyboard.press('Home');
    const local = position - (source.lastIndexOf('\n', position - 1) + 1);
    for (let i = 0; i < local; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.pure.getText()), expected, source);
    await page.keyboard.press('Control+z'); assert.equal(await page.evaluate(() => window.pure.getText()), source);
    await page.keyboard.press('Control+y'); assert.equal(await page.evaluate(() => window.pure.getText()), expected);
    await page.evaluate(() => window.pure.destroy());
  }
  await page.evaluate(() => {
    window.pure = window.module.exports.mountCanvasEditor({ markdown: '-\n*\n\nAfter' });
  });
  await page.keyboard.press('Control+End');
  await page.waitForFunction(() => window.pure.getStats().drawnLines === 4);
  const dots = await page.evaluate(() => {
    const canvas = window.pure.host.shadowRoot.querySelector('canvas'), ctx = canvas.getContext('2d');
    return [0, 1].map(i => {
      const r = window.pure.getLineRect(i), d = ctx.getImageData(Math.floor(r.x), Math.floor(r.y), 34, Math.ceil(r.height)).data;
      let count = 0; for (let n = 0; n < d.length; n += 4) if (d[n] < 160 && d[n + 1] < 160 && d[n + 2] < 160) count++;
      return count;
    });
  });
  assert.ok(dots.every(n => n > 0), JSON.stringify(dots));
  await page.screenshot({ path: 'test-output/lists-empty-bullets.png' });
  await page.evaluate(() => window.pure.destroy());
  const blocks = 'Intro\n\n- Item\n  ```js\n  const x = 1;\n  ```\n  > [!note] Nested\n  > Text $a$\n  >\n  > a. Alpha\n  > b. Beta\n\n  > Quote\n- > [!proof] Direct\n  > [Open](https://example.com/nested)\n- Last\n\nAfter';
  await page.evaluate(source => {
    const write = document.querySelector('#write');
    const getTheme = () => window.module.exports.readCanvasTheme({ write, content: document.querySelector('#content') });
    const nativeCallouts = window.module.exports.createNativeCalloutRenderer({ write, plugin: window.calloutTestPlugin });
    const render = nativeCallouts.render.bind(nativeCallouts); window.listCaptures = [];
    nativeCallouts.render = async request => { const result = await render(request); window.listCaptures.push({ markdown: request.markdown, links: result.links, titleBaseline: result.titleBaseline }); return result; };
    window.pure = window.module.exports.mountCanvasEditor({ markdown: source, theme: getTheme(), getTheme, nativeCallouts, onOpenLink: href => { window.listLink = href; } });
  }, blocks);
  await page.waitForFunction(() => window.pure.getStats().nativeCallouts.ready === 2 && window.pure.getStats().nativeCallouts.drawnSlices >= 7 && window.pure.getStats().highlightedCodeLines > 0);
  const stats = await page.evaluate(() => window.pure.getStats());
  assert.equal(stats.codeBlocks, 1); assert.equal(stats.calloutGroups, 2);
  assert.deepEqual(stats.nativeCallouts.errors, []); assert.deepEqual(stats.nativeCallouts.formulaErrors, []);
  const link = await page.evaluate(() => {
    const capture = window.listCaptures.find(c => c.markdown.includes('[Open]')), rect = window.pure.getLineRect(13);
    const marker = window.pure.getStats().typography.lists.ul, inset = marker.paddingLeft + marker.marginLeft + (marker.item.paddingLeft || 0);
    const canvas = window.pure.host.shadowRoot.querySelector('canvas'), ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(Math.floor(rect.x + inset - 20), Math.floor(rect.y), 18, Math.ceil(rect.height)).data;
    let ink = 0; for (let n = 0; n < pixels.length; n += 4) if (pixels[n] < 170 && pixels[n + 1] < 170 && pixels[n + 2] < 170) ink++;
    return { x: rect.x + inset + capture.links[0].x + 5, y: rect.y + capture.links[0].y + 5, ink };
  });
  assert.ok(link.ink > 0, 'a list item beginning with a native Callout still renders its outside bullet');
  const main = await page.locator('[data-typora-canvas-editor]').locator('main').boundingBox();
  await page.keyboard.down('Control'); await page.mouse.click(main.x + link.x, main.y + link.y); await page.keyboard.up('Control');
  assert.equal(await page.evaluate(() => window.listLink), 'https://example.com/nested');
  await page.screenshot({ path: 'test-output/lists-nested-blocks.png' });
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < blocks.indexOf('Alpha') + 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.pure.getText()), blocks.replace('a. Alpha\n  > b. Beta', 'a. Alpha\n  > b. \n  > c. Beta'));
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.pure.getText()), blocks);
  await page.keyboard.press('Control+End');
  await page.waitForFunction(() => window.pure.getStats().nativeCallouts.ready === 2);
  await page.evaluate(() => window.pure.destroy());
  console.log('Lists: theme markers/indent, mixed nesting, continuation, hanging wraps, math, editing/undo and theme change passed');
}
