import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

export async function testDisplayMathSpacing(page) {
  const source = await readFile(new URL('./fixtures/display-math-spacing.md', import.meta.url), 'utf8');
  // Newlines inside an aligned environment produce a taller block. Keep a
  // paragraph directly after it to catch parsing that consumes later content.
  const markdown = source + '>\n> $$\\begin{aligned}\n> a&=\\dfrac{1}{2}\\\\\n> b&=\\dfrac{3}{4}\\\\\n> c&=\\sum_{i=1}^{10}i\n> \\end{aligned}$$\n>\n> 多行公式后的正文。\n>\n> $$\\begin{pmatrix}1&2\\\\3&4\\\\5&6\\end{pmatrix}$$\n> 最后的正文。';
  for (const size of [18, 28]) for (const width of [420, 900]) {
    const result = await page.evaluate(async ({ markdown, size, width }) => {
      const write = document.querySelector('#write'), old = write.style.cssText;
      write.style.setProperty('font-size', `${size}px`, 'important');
      const bridge = window.module.exports.createNativeCalloutRenderer({ write, plugin: window.calloutTestPlugin });
      let geometry;
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      try {
        const image = await bridge.render({ markdown, width, valid: () => {
          const stage = document.querySelector('[data-typora-canvas-callout-stage]');
          if (stage?.querySelector('[data-tc-math] svg')) geometry = [...stage.querySelectorAll('[data-tc-math][data-display=true]')].map(el => ({
            box: rect(el), svg: rect(el.firstElementChild), gap: parseFloat(el.style.paddingTop),
            after: el.parentElement.nextElementSibling ? rect(el.parentElement.nextElementSibling) : null }));
          return true;
        } });
        const result = { geometry, starts: image.starts, errors: image.formulaErrors, height: image.height, url: image.image.toDataURL() };
        image.image.width = image.image.height = 0; return result;
      } finally { bridge.destroy(); write.style.cssText = old; }
    }, { markdown, size, width });
    assert.deepEqual(result.errors, []);
    assert.equal(result.geometry.length, 6, 'the multiline parser must stop at its own closing delimiter');
    for (const { box, svg, gap, after } of result.geometry) {
      assert.equal(gap, Math.ceil(size * .65));
      assert.ok(Math.abs(box.height - svg.height - 2 * gap) < .1, JSON.stringify({ box, svg, gap }));
      assert.ok(Math.abs(svg.y - box.y - gap) < .1);
      assert.ok(svg.bottom <= box.bottom - gap + .1);
      assert.ok(svg.width <= width);
      if (after) assert.ok(after.y >= box.bottom - .1, 'next block must start below this formula including its gap');
    }
    assert.ok(result.geometry[4].svg.height > result.geometry[3].svg.height * 2);
    assert.ok(result.starts.every((y, i) => !i || y >= result.starts[i - 1]));
    await writeFile(`test-output/math-spacing-${size}-${width}.png`, Buffer.from(result.url.split(',')[1], 'base64'));
  }
  console.log('Display math spacing: actual SVG height + font-relative gaps, at 18/28px and 420/900px widths');
}
