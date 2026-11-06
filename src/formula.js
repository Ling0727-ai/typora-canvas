import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document('', { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: 'none' }) });

// MathJax computes paths; no live HTML or native Typora nodes are rasterized.
export function formulaSvg(tex, { size = 18, color = '#243044', display = true } = {}) {
  const result = document.convert(tex, { display, em: size, ex: size / 2, containerWidth: 900 });
  const svg = adaptor.firstChild(result);
  const width = parseFloat(adaptor.getAttribute(svg, 'width')) * size / 2;
  const height = parseFloat(adaptor.getAttribute(svg, 'height')) * size / 2;
  const alignment = /vertical-align:\s*(-?[\d.]+)(ex|em|px)/.exec(adaptor.getAttribute(svg, 'style') || '');
  const unit = alignment?.[2] === 'em' ? size : alignment?.[2] === 'px' ? 1 : size / 2;
  const depth = alignment ? Math.max(0, -Number(alignment[1]) * unit) : 0;
  adaptor.setAttribute(svg, 'width', `${Math.max(1, width)}px`);
  adaptor.setAttribute(svg, 'height', `${Math.max(1, height)}px`);
  adaptor.setAttribute(svg, 'color', color);
  adaptor.setAttribute(svg, 'xmlns', 'http://www.w3.org/2000/svg');
  return { svg: adaptor.outerHTML(svg), width, height, depth, ascent: Math.max(0, height - depth) };
}
