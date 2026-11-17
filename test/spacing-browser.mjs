import assert from 'node:assert/strict';

export async function testFirstLineBlockSpacing(page) {
  const paddingTop = 96;
  const cases = [
    { name: 'empty-quote', source: '>\n> Body\n\nAfter' },
    { name: 'quote', source: '> First line\n> Body\n\nAfter' },
    { name: 'callout', source: '> [!note] First title\n> Body\n\nAfter' },
    { name: 'nested-callout', source: '> [!note] First title\n> > [!tip] Nested title\n> > Body\n\nAfter' },
    { name: 'native-callout', source: '> [!note] First title\n> Body\n\nAfter', native: true },
  ];
  for (const entry of cases) {
    await page.evaluate(({ entry, paddingTop }) => {
      const write = document.querySelector('#write');
      const theme = window.module.exports.readCanvasTheme({ write, content: document.querySelector('#content') });
      theme.background = '#fff';
      theme.container = { maxWidth: 800, paddingTop, paddingBottom: 24, paddingLeft: 24, paddingRight: 24 };
      // A glyph makes the fallback title decoration deterministic, with no
      // asynchronous icon fetch masking a misplaced first-line icon.
      for (const spec of Object.values(theme.callouts.types)) {
        spec.iconUrl = ''; spec.iconGlyph = '◆'; spec.iconFont = 'Arial';
        spec.background = '#f2efff'; spec.borderColor = '#d02040'; spec.color = '#d02040';
      }
      const nativeCallouts = entry.native ? window.module.exports.createNativeCalloutRenderer({ write, plugin: window.calloutTestPlugin }) : null;
      window.pure = window.module.exports.mountCanvasEditor({ markdown: entry.source, theme, nativeCallouts });
    }, { entry, paddingTop });
    await page.waitForFunction(() => window.pure.getStats().drawnLines > 0);
    const assertPadding = async state => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(paddingTop => {
        const canvas = window.pure.host.shadowRoot.querySelector('canvas');
        const scale = canvas.width / canvas.getBoundingClientRect().width;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.floor(paddingTop * scale)).data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) return false;
        }
        return true;
      }, paddingTop, { timeout: 3000 });
      assert.equal(await page.evaluate(() => window.pure.getText()), entry.source, `${entry.name} ${state}`);
    };
    await assertPadding('initial editing');
    await page.keyboard.press('Control+End');
    if (entry.native) await page.waitForFunction(() => window.pure.getStats().nativeCallouts.ready === 1);
    await assertPadding('preview');
    // Padding must not hide the entire block as a side effect of moving its
    // border/background. Check the quote marker or Callout body still paints.
    const blockHasInk = await page.evaluate(paddingTop => {
      const canvas = window.pure.host.shadowRoot.querySelector('canvas');
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const data = canvas.getContext('2d').getImageData(0, Math.ceil(paddingTop * scale), canvas.width, Math.ceil(80 * scale)).data;
      return data.some((value, i) => i % 4 !== 3 && value < 240);
    }, paddingTop);
    assert.ok(blockHasInk, `${entry.name} block remains visible below padding`);
    await page.screenshot({ path: `test-output/first-line-${entry.name}.png` });
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('End');
    await assertPadding('active source');
    await page.keyboard.insertText('X');
    await page.keyboard.press('Control+z');
    await assertPadding('undo');
    await page.evaluate(() => window.pure.destroy());
  }
}

export async function testSpacingAndQuoteEditing(page) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addStyleTag({ content: `body.spacing-test #write{font:20px/32px Arial;padding:0;min-height:0!important}
    body.spacing-test #write p{font:inherit;margin:8px 0;padding:0}
    body.spacing-test #write p.md-p{min-height:30px}
    body.spacing-test #write h2,body.spacing-test #write h3{margin:12px 0;font:700 24px/36px Arial}
    body.spacing-large #write{font:24px/42px Arial}` });
  const source = '## Section\n\n### Requirements\n\nFirst\n\nSecond\n\n\nThird';
  await page.evaluate(source => {
    document.body.classList.add('spacing-test');
    const write = document.querySelector('#write'); write.style.display = '';
    const getTheme = () => window.module.exports.readCanvasTheme({ write, content: document.querySelector('#content') });
    window.pure = window.module.exports.mountCanvasEditor({ markdown: source, theme: getTheme(), getTheme, themeNodes: [write] });
  }, source);
  await page.waitForFunction(() => window.pure.getLineRect(5).height === 40);
  for (const i of [1, 3]) assert.ok((await page.evaluate(i => window.pure.getLineRect(i).height, i)) < .1);
  for (const i of [5, 7, 8]) assert.equal(await page.evaluate(i => window.pure.getLineRect(i).height, i), 40);
  const host = page.locator('[data-typora-canvas-editor]');
  const main = await host.locator('main').boundingBox(), blank = await page.evaluate(() => window.pure.getLineRect(5));
  await page.mouse.click(main.x + blank.x + 10, main.y + blank.y + 5);
  assert.equal(await page.evaluate(() => window.pure.getStats().selection.head), source.indexOf('\n\nSecond') + 1);
  await page.keyboard.insertText('Inserted');
  assert.equal(await page.evaluate(() => window.pure.getText()), source.replace('First\n\n', 'First\nInserted\n'));
  await page.keyboard.press('Control+z'); assert.equal(await page.evaluate(() => window.pure.getText()), source);
  await page.evaluate(() => document.body.classList.add('spacing-large'));
  await page.waitForFunction(() => window.pure.getLineRect(5).height === 50);
  assert.ok((await page.evaluate(() => window.pure.getLineRect(1).height)) < .1);
  await page.screenshot({ path: 'test-output/paragraph-spacing.png' });
  await page.evaluate(() => { window.pure.destroy(); document.body.classList.remove('spacing-large'); });

  const captured = await page.evaluate(async () => {
    const bridge = window.module.exports.createNativeCalloutRenderer({ write: document.querySelector('#write'), plugin: window.calloutTestPlugin });
    const sources = ['> [!proof] Title\n> First\n>\n> Last', '> [!proof] Title\n> First\n>\n>\n> Last',
      '> [!proof] Title\n> First\n>\n> Last\n>\n>', '> [!proof] Title\n> First', '> [!proof] Title\n> First<br>Second'];
    try {
      const results = [];
      for (const markdown of sources) {
        const result = await bridge.render({ markdown, width: 700 });
        results.push({ height: result.height, starts: result.starts }); result.image.width = result.image.height = 0;
      }
      return results;
    } finally { bridge.destroy(); }
  });
  assert.ok(captured[1].height - captured[0].height >= 32, JSON.stringify(captured));
  assert.equal(captured[2].height, captured[0].height, 'trailing Callout blanks do not increase capture height');
  assert.ok(captured[0].starts[3] - captured[0].starts[2] >= 32, 'internal blank retains its source slice');
  assert.equal(captured[4].height - captured[3].height, 32, 'explicit br is rendered by the native plugin bridge');

  for (const native of [false, true]) {
    const quote = '> [!proof] A strength condition\n> Body\n>\n> Last\n>\n>\n\nAfter';
    await page.evaluate(({ quote, native }) => {
      const write = document.querySelector('#write');
      const theme = window.module.exports.readCanvasTheme({ write, content: document.querySelector('#content') });
      const nativeCallouts = native ? window.module.exports.createNativeCalloutRenderer({ write, plugin: window.calloutTestPlugin }) : null;
      window.pure = window.module.exports.mountCanvasEditor({ markdown: quote, theme, nativeCallouts });
    }, { quote, native });
    await page.waitForFunction(() => window.pure.getStats().drawnLines > 0);
    await page.keyboard.press('Control+End');
    if (native) await page.waitForFunction(() => window.pure.getStats().nativeCallouts.ready === 1);
    await page.keyboard.press('Control+Home'); await page.keyboard.press('End');
    // Click at the beginning of the exposed source line, before its quote marker.
    const rect = await page.evaluate(() => window.pure.getLineRect(0));
    const bounds = await host.locator('main').boundingBox();
    await page.mouse.click(bounds.x + rect.x + 1, bounds.y + rect.y + 5);
    assert.equal(await page.evaluate(() => window.pure.getStats().selection.head), 0, `prefix click, native=${native}`);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.pure.getText()), '\n' + quote);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home');
    const pos = quote.indexOf('> Body');
    assert.equal(await page.evaluate(() => window.pure.getStats().selection.head), pos);
    await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => window.pure.getStats().selection.head), pos + 1);
    await page.keyboard.press('ArrowLeft'); assert.equal(await page.evaluate(() => window.pure.getStats().selection.head), pos);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => window.pure.getStats().selection.head), quote.indexOf('\n>\n') + 1);
    assert.equal(await page.evaluate(() => window.pure.getText()), quote);
    await page.evaluate(() => window.pure.destroy());
  }
  await page.evaluate(() => document.body.classList.remove('spacing-test'));
  console.log('Paragraph spacing / quote prefix regressions passed:', JSON.stringify(captured));
}
