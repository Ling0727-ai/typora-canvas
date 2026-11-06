import MarkdownIt from 'markdown-it';
import { toCanvas } from 'html-to-image';
import { FormulaEngine } from './formula-client.js';
import { displayMathGeometry } from './math-geometry.js';

// Run a second, unregistered instance of the installed plugin with scoped
// entities. Its lifecycle/hotkeys never run and its original instance is intact.
export function createNativeCalloutRenderer({ write, plugin, images = null }) {
  if (!write || !plugin?.constructor || typeof plugin.setCallouts !== 'function') return null;
  const doc = write.ownerDocument, formulas = new FormulaEngine();
  const instance = new plugin.constructor(plugin.fixedName, plugin.config, plugin.i18n);
  let stage = null, disposed = false, generation = 0, queue = Promise.resolve();
  const entities = Object.create(plugin.utils.entities);
  entities.querySelectorAllInWrite = selector => stage.querySelectorAll(selector);
  entities.querySelectorInWrite = selector => stage.querySelector(selector);
  Object.defineProperty(entities, 'eWrite', { get: () => stage });
  instance.utils = Object.create(plugin.utils);
  Object.defineProperty(instance.utils, 'entities', { value: entities });
  const md = new MarkdownIt({ html: false, breaks: false, linkify: false });
  if (images) md.inline.ruler.before('image', 'canvas_wiki_image', (state, silent) => {
    const image = images.parseWiki(state.src.slice(state.pos));
    if (!image) return false;
    if (!silent) {
      const token = state.push('image', 'img', 0); token.attrs = [['src', image.file], ['alt', image.file]];
      token.meta = { obsidianImage: { ...image, obsidian: true } }; token.children = [];
    }
    state.pos += image.raw.length; return true;
  });
  const imageRule = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, i, options, env, renderer) => {
    const html = imageRule(tokens, i, options, env, renderer), spec = tokens[i].meta?.obsidianImage;
    if (!spec) return html;
    const template = doc.createElement('template'); template.innerHTML = html;
    const img = images.decorate(template.content.querySelector('img'), spec);
    img.dataset.tcImage = JSON.stringify(spec); return img.outerHTML;
  };
  const mathHtml = (tex, display) => `<span data-tc-math="${md.utils.escapeHtml(tex)}" data-display="${display}"></span>`;
  md.inline.ruler.before('escape', 'canvas_math', (state, silent) => {
    const start = state.pos;
    if (state.src[start] !== '$' || state.src[start + 1] === '$') return false;
    let end = start + 1;
    while ((end = state.src.indexOf('$', end)) >= 0 && state.src[end - 1] === '\\') end++;
    if (end < 0 || state.src.slice(start + 1, end).includes('\n')) return false;
    if (!silent) { const token = state.push('canvas_math', '', 0); token.content = state.src.slice(start + 1, end); }
    state.pos = end + 1; return true;
  });
  md.renderer.rules.canvas_math = (tokens, i) => mathHtml(tokens[i].content, false);
  md.block.ruler.before('fence', 'canvas_display_math', (state, line, end, silent) => {
    const first = state.getLines(line, line + 1, state.blkIndent, false).trim();
    if (!first.startsWith('$$')) return false;
    let text = first.slice(2), next = line + 1;
    while (!text.trimEnd().endsWith('$$') && next < end) text += '\n' + state.getLines(next, ++next, state.blkIndent, false).replace(/\n$/, '');
    if (!text.trimEnd().endsWith('$$')) return false;
    if (silent) return true;
    const token = state.push('canvas_display_math', '', 0); token.content = text.trimEnd().slice(0, -2); token.map = [line, next];
    state.line = next; return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.canvas_display_math = (tokens, i) => `<div data-tc-line="${tokens[i].map[0]}">${mathHtml(tokens[i].content, true)}</div>`;
  // Preserve native paragraph/softbreak structure, including the marker span
  // consumed by Callouts.decorateTitle. Attributes only map pixels to source.
  const render = source => {
    const tokens = md.parse(source, {});
    for (const token of tokens) {
      if (token.map && token.nesting === 1) token.attrSet('data-tc-line', String(token.map[0]));
      if (token.type === 'inline') token.type = 'canvas_inline';
    }
    md.renderer.rules.canvas_inline = (all, i, options, env, renderer) => {
      const token = all[i], children = token.children || [], groups = [[]];
      for (const child of children) {
        if (child.type === 'softbreak' || child.type === 'hardbreak') groups.push([]);
        else groups.at(-1).push(child);
      }
      return groups.map((group, j) => {
        const line = (token.map?.[0] || 0) + j;
        const first = group[0], match = first?.type === 'text' && /^(\[!\w+\][+-]?)[\t ]*/.exec(first.content);
        if (match) {
          return `<span data-tc-line="${line}">${md.utils.escapeHtml(first.content)}</span>${group.length > 1 ? `<span>${renderer.renderInline(group.slice(1), options, env)}</span>` : ''}`;
        }
        return `<span data-tc-line="${line}">${renderer.renderInline(group, options, env)}</span>`;
      }).join('<br>');
    };
    return md.renderer.render(tokens, md.options, {});
  };
  async function capture({ markdown, width, folded = [], pixelRatio = 1, valid = () => true }, epoch) {
    if (disposed || epoch !== generation || !valid()) throw new Error('Callout capture cancelled');
    const count = markdown.split('\n').length;
    if (markdown.length > 60000 || count > 300) throw new Error('Callout exceeds capture budget');
    stage = write.cloneNode(false); stage.removeAttribute('contenteditable'); stage.removeAttribute('style');
    stage.classList.remove('typewriter-mode', 'md-focus', 'tc-hybrid-idle');
    stage.dataset.typoraCanvasCalloutStage = '';
    const computed = getComputedStyle(write);
    // Custom properties can be inherited from a theme-specific editor ancestor.
    for (const property of computed) if (property.startsWith('--')) stage.style.setProperty(property, computed.getPropertyValue(property));
    Object.assign(stage.style, { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, maxWidth: 'none',
      margin: '0', padding: '0', display: 'block', visibility: 'visible', pointerEvents: 'none',
      color: computed.color, fontFamily: computed.fontFamily, fontSize: computed.fontSize, lineHeight: computed.lineHeight,
      background: 'transparent', overflow: 'visible', contain: 'layout style', zIndex: '-1' });
    // Native #write is a full-page editor (min-height:100vh/100%, typewriter
    // padding, sometimes important theme geometry). Capture only this block's
    // intrinsic height; inheriting the viewport constraint inserts a blank page.
    const geometry = { position: 'fixed', left: '-100000px', right: 'auto', top: '0', bottom: 'auto',
      width: `${width}px`, minWidth: '0', maxWidth: 'none', height: 'auto', minHeight: '0', maxHeight: 'none',
      margin: '0', padding: '0', display: 'flow-root', transform: 'none', boxSizing: 'border-box',
      visibility: 'visible', pointerEvents: 'none', transition: 'none', animation: 'none' };
    for (const [key, value] of Object.entries(geometry)) stage.style.setProperty(key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), value, 'important');
    stage.setAttribute('aria-hidden', 'true'); stage.innerHTML = render(markdown); doc.body.append(stage);
    try {
      for (const p of stage.querySelectorAll('p')) {
        while (p.firstChild?.nodeType === 3 && !p.firstChild.textContent.trim()) p.firstChild.remove();
      }
      // Typora represents its five built-in alert types with .md-alert, even
      // when a custom title requires the Callouts plugin's title decorator.
      for (const quote of stage.querySelectorAll('blockquote')) {
        const type = /^\[!(note|tip|important|warning|caution)\]/i.exec(quote.firstElementChild?.textContent || '')?.[1].toLowerCase();
        if (!type) continue;
        const alert = doc.createElement('div'); alert.className = `md-alert md-alert-${type}`;
        alert.dataset.tcLine = quote.dataset.tcLine; alert.append(...quote.childNodes); quote.replaceWith(alert);
      }
      instance.setCallouts();
      if (!stage.querySelector('.plugin-callout')) throw new Error('Installed Callout plugin did not decorate the preview');
      await Promise.all([...stage.querySelectorAll('img')].map(async img => {
        const spec = img.dataset.tcImage ? JSON.parse(img.dataset.tcImage) : {};
        const source = img.getAttribute('src');
        if (images) img.src = await images.resolve(source, spec);
        if (!img.complete) await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { cleanup(); reject(new Error('Callout image loading timed out')); }, 10000);
          const cleanup = () => { clearTimeout(timer); img.onload = img.onerror = null; };
          img.onload = () => { cleanup(); resolve(); }; img.onerror = () => { cleanup(); resolve(); };
        });
      }));
      for (const block of stage.querySelectorAll('.plugin-callout')) {
        const line = Number(block.getAttribute('data-tc-line'));
        block.classList.toggle('callout-folded', folded.includes(line));
      }
      const formulaErrors = [];
      await Promise.all([...stage.querySelectorAll('[data-tc-math]')].map(async node => {
        const display = node.dataset.display === 'true', style = getComputedStyle(node);
        const size = parseFloat(style.fontSize) || 17;
        if (display) Object.assign(node.style, { display: 'block', textAlign: 'center' });
        try {
          const result = await formulas.render(node.dataset.tcMath, { display, size, color: style.color });
          const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement;
          Object.assign(svg.style, { width: `${result.width}px`, height: `${result.height}px`, verticalAlign: `-${result.depth}px` });
          node.replaceChildren(doc.importNode(svg, true));
          if (display) {
            // Block SVGs participate in normal flow with their full, scaled
            // height. Baseline/depth adjustment is only for inline formulas.
            const image = node.firstElementChild;
            const box = displayMathGeometry(result, node.getBoundingClientRect().width, size);
            const set = (el, rules) => {
              for (const [key, value] of Object.entries(rules)) el.style.setProperty(key, value, 'important');
            };
            set(node, { display: 'block', height: 'auto', 'min-height': '0', 'max-height': 'none',
              'box-sizing': 'content-box', 'line-height': '0', margin: '0',
              padding: `${box.top}px 0 ${box.bottom}px`, overflow: 'visible' });
            set(image, { display: 'block', position: 'static', width: `${box.mediaWidth}px`, height: `${box.mediaHeight}px`,
              'min-height': '0', 'max-height': 'none', 'max-width': 'none', margin: '0 auto', padding: '0',
              'vertical-align': '0', 'box-sizing': 'content-box' });
          }
        } catch (error) {
          // Keep the successful equations and the plugin's decorated block.
          // A single bad equation must not discard and recapture the Callout.
          const marker = display ? '$$' : '$';
          node.textContent = `${marker}${node.dataset.tcMath}${marker}`;
          node.title = `公式渲染失败：${error.message}`;
          Object.assign(node.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
          formulaErrors.push(error.message);
        }
      }));
      if (disposed || epoch !== generation || !valid()) throw new Error('Callout capture cancelled');
      const bounds = stage.getBoundingClientRect(), height = Math.ceil(bounds.height);
      const links = [...stage.querySelectorAll('a[href]')].flatMap(a => [...a.getClientRects()].map(r => ({
        href: a.getAttribute('href'), x: r.left - bounds.left, y: r.top - bounds.top, width: r.width, height: r.height })));
      const ratio = Math.min(2, pixelRatio);
      if (!height || height > 12000 || width * height * ratio * ratio * 4 > 24 * 1024 * 1024) throw new Error('Callout exceeds pixel budget');
      const positions = new Map([[0, 0]]);
      for (const node of stage.querySelectorAll('[data-tc-line]')) {
        const line = Number(node.dataset.tcLine), rect = node.getBoundingClientRect();
        if (line > 0 && rect.width && rect.height && !positions.has(line)) positions.set(line, Math.max(0, rect.top - bounds.top));
      }
      // html-to-image rounds font sizes down by .1px. Its negative result for
      // 0px is rejected by CSS, exposing the plugin's hidden marker text unless
      // the cloned node already carries an explicit zero size.
      for (const node of stage.querySelectorAll('*')) if (getComputedStyle(node).fontSize === '0px') node.style.fontSize = '0px';
      const starts = Array(count + 1); starts[0] = 0; starts[count] = height;
      for (let i = count - 1; i > 0; i--) starts[i] = Math.min(starts[i + 1], positions.get(i) ?? starts[i + 1]);
      const canvas = await toCanvas(stage, { width, height, pixelRatio: ratio, skipFonts: true, cacheBust: false,
        style: { position: 'static', left: '0', top: '0', zIndex: 'auto', contain: 'none' } });
      if (disposed || epoch !== generation || !valid()) { canvas.width = canvas.height = 0; throw new Error('Callout capture cancelled'); }
      return { image: canvas, width, height, starts, ratio, formulaErrors, links };
    } finally { stage?.remove(); stage = null; }
  }
  return {
    render(request) { const epoch = generation; const result = queue.then(() => capture(request, epoch)); queue = result.catch(() => {}); return result; },
    invalidate() { generation++; formulas.destroy('Callout theme changed'); },
    destroy() { disposed = true; generation++; formulas.destroy(); stage?.remove(); }
  };
}
