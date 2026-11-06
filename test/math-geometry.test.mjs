import test from 'node:test';
import assert from 'node:assert/strict';
import { formulaSvg } from '../src/formula.js';
import { displayMathGeometry } from '../src/math-geometry.js';
import { layoutSourceLine } from '../src/editor-layout.js';

test('display formula occupation is its actual scaled SVG height plus two font-relative gaps', () => {
  for (const size of [14, 18, 28]) {
    const texes = ['x^2', '\\dfrac{270}{1.91919\\times60+0.2\\times40}=2.192',
      '\\begin{aligned}a&=\\dfrac{1}{2}\\\\b&=\\dfrac{3}{4}\\\\c&=\\sum_{i=1}^{10}i\\end{aligned}',
      '\\begin{pmatrix}1&2\\\\3&4\\\\5&6\\end{pmatrix}'];
    const media = texes.map(tex => ({ ...formulaSvg(tex, { size }), image: {} }));
    assert.ok(media[2].height > media[0].height * 2);
    for (const width of [100, 600]) for (const item of media) {
      const layout = layoutSourceLine({ font: '' }, '$$x$$', { type: 'math', tex: 'x' }, {
        width, size, raw: false, asset: () => item, measure: () => 10 });
      const expectedHeight = item.height * Math.min(1, width / item.width);
      assert.equal(layout.mediaHeight, expectedHeight);
      assert.equal(layout.height, expectedHeight + 2 * Math.ceil(size * .65));
      assert.equal(layout.top, Math.ceil(size * .65));
      assert.ok(layout.top + layout.mediaHeight < layout.height);
      assert.ok(layout.mediaWidth <= width);
    }
  }
});

test('tall equations are not limited by an unrelated fixed media height', () => {
  const box = displayMathGeometry({ width: 200, height: 1600 }, 300, 20);
  assert.equal(box.mediaHeight, 1600); assert.equal(box.height, 1626);
  const narrower = displayMathGeometry({ width: 800, height: 200 }, 400, 20);
  assert.equal(narrower.mediaHeight, 100); assert.equal(narrower.height, 126);
});
