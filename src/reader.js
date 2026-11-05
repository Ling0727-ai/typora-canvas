import { parseMarkdown } from './markdown.js';
import { HeightIndex } from './height-index.js';
import { LruCache, estimateHeight, layoutBlock } from './layout.js';
import css from './reader.css';

export function mountReader({ markdown, title = 'Typora Canvas', onClose = () => {}, parent = document.body }) {
  const started = performance.now();
  const blocks = parseMarkdown(markdown);
  const parseMs = performance.now() - started;
  const host = document.createElement('div');
  host.dataset.typoraCanvas = '';
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483000' });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style><section class="reader" aria-label="Typora Canvas 阅读模式">
    <header><strong>Typora Canvas</strong><span class="title"></span>
    <input type="search" placeholder="搜索全文 · Ctrl+F" aria-label="搜索全文">
    <button class="previous" title="上一个 · Shift+Enter">↑</button><button class="next" title="下一个 · Enter">↓</button>
    <span class="matches"></span><button class="close">返回编辑 · Esc</button></header>
    <div class="notice">Canvas 阅读预览 · 公式与图片显示为源码或占位文字；选取、复制和完整排版请返回编辑。</div>
    <main><div class="scroll" tabindex="0" role="region" aria-label="Canvas 阅读区，按 Escape 返回可访问的原始编辑器"><div class="spacer"></div></div>
    <canvas aria-hidden="true"></canvas></main><footer role="status"></footer></section>`;
  root.querySelector('.title').textContent = title;
  parent.append(host);
  const main = root.querySelector('main');
  const scroll = root.querySelector('.scroll');
  const spacer = root.querySelector('.spacer');
  const canvas = root.querySelector('canvas');
  const search = root.querySelector('input');
  const footer = root.querySelector('footer');
  const matches = root.querySelector('.matches');
  const ctx = canvas.getContext('2d');
  if (!ctx) { host.remove(); throw new Error('Canvas 2D is unavailable'); }
  const layouts = new LruCache(256);
  const measures = new LruCache(8192);
  let index, width = 0, height = 0, contentWidth = 0, left = 0, dpr = 0;
  let raf = 0, destroyed = false, hits = [], hitSet = new Set(), hitPosition = -1, searchTimer;
  let stats = { parseMs, paintMs: 0, drawnBlocks: 0, measuredThisFrame: 0 };
  const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(paint); };
  const anchor = () => {
    const block = index?.find(scroll.scrollTop) || 0;
    return { block, within: index ? scroll.scrollTop - index.prefix(block) : 0 };
  };
  const restoreAnchor = saved => {
    if (index.length) scroll.scrollTop = index.prefix(saved.block) + Math.min(saved.within, Math.max(0, index.values[saved.block] - 1));
  };
  function resize() {
    const nextWidth = Math.max(1, main.clientWidth);
    const nextHeight = Math.max(1, main.clientHeight);
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
    const saved = anchor();
    const widthChanged = width !== nextWidth;
    width = nextWidth; height = nextHeight; dpr = nextDpr;
    // Keep the canvas outside the scrolling content. Its backing store is
    // bounded by viewport dimensions, never by document length.
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    contentWidth = Math.max(40, Math.min(900, scroll.clientWidth - 48));
    left = Math.max(16, (scroll.clientWidth - contentWidth) / 2);
    if (widthChanged || !index) {
      layouts.clear(); measures.clear();
      index = new HeightIndex(blocks.map(b => estimateHeight(b, contentWidth)));
      spacer.style.height = `${Math.max(height, index.total + 48)}px`;
      restoreAnchor(saved);
    }
    schedule();
  }
  const textColor = '#243044';
  function drawBlock(block, layout, y, highlighted) {
    if (highlighted) { ctx.fillStyle = '#fff1b5'; ctx.fillRect(left - 8, y, contentWidth + 16, layout.height); }
    if (block.type === 'rule') {
      ctx.fillStyle = '#cdd4df'; ctx.fillRect(left, y + 15, contentWidth, 1); return;
    }
    if (block.type === 'code' || block.header) {
      ctx.fillStyle = '#eef2f7'; ctx.fillRect(left + layout.indent, y, contentWidth - layout.indent, layout.height);
    }
    if (block.quote) { ctx.fillStyle = '#94a7c0'; ctx.fillRect(left, y, 3, layout.height); }
    const drawLines = lines => lines.forEach((pieces, row) => {
      const baseline = y + layout.top + (row + 0.8) * layout.lineHeight;
      for (const piece of pieces) {
        ctx.font = piece.font;
        const x = left + piece.x;
        if (piece.code && block.type !== 'code') {
          ctx.fillStyle = '#edf0f5'; ctx.fillRect(x, baseline - layout.size, piece.width, layout.size + 5);
        }
        ctx.fillStyle = piece.link ? '#2864bb' : textColor;
        ctx.fillText(piece.text, x, baseline);
        if (piece.strike) ctx.fillRect(x, baseline - layout.size * 0.3, piece.width, 1);
      }
    });
    if (layout.cells) {
      layout.cells.forEach(drawLines);
      ctx.strokeStyle = '#ccd4df'; ctx.lineWidth = 1;
      ctx.strokeRect(left + layout.indent, y, contentWidth - layout.indent, layout.height);
      for (let i = 1; i < layout.cells.length; i++) {
        const x = left + layout.indent + i * layout.cellWidth;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + layout.height); ctx.stroke();
      }
    } else drawLines(layout.lines);
  }
  function paint() {
    raf = 0;
    if (destroyed || !index) return;
    if (dpr !== Math.min(window.devicePixelRatio || 1, 2)) { resize(); return; }
    const frameStart = performance.now();
    const saved = anchor();
    const start = index.find(Math.max(0, scroll.scrollTop - 400));
    let measured = 0, exhausted = false;
    // Layout a viewport plus a small buffer. Yield if layout consumes a frame.
    for (let i = start; i < blocks.length; i++) {
      if (index.prefix(i) > scroll.scrollTop + height + 400) break;
      if (!layouts.get(i)) {
        const layout = layoutBlock(ctx, blocks[i], contentWidth, measures);
        layouts.set(i, layout); index.update(i, layout.height); measured++;
        if (performance.now() - frameStart > 8) { exhausted = true; break; }
      }
    }
    spacer.style.height = `${Math.max(height, index.total + 48)}px`;
    restoreAnchor(saved);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fafbfd'; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, scroll.clientWidth, height); ctx.clip();
    let drawn = 0;
    const first = index.find(scroll.scrollTop);
    for (let i = first; i < blocks.length; i++) {
      const y = index.prefix(i) - scroll.scrollTop;
      if (y > height) break;
      const layout = layouts.get(i);
      if (layout) { drawBlock(blocks[i], layout, y, hitSet.has(i)); drawn++; }
    }
    ctx.restore();
    stats = { parseMs, paintMs: performance.now() - frameStart, drawnBlocks: drawn, measuredThisFrame: measured };
    footer.textContent = `${blocks.length.toLocaleString()} 块 · 当前绘制 ${drawn} 块 · 布局缓存 ${layouts.size}/256 · ${stats.paintMs.toFixed(1)} ms`;
    if (exhausted) schedule();
  }
  function scrollToBlock(block) {
    if (!index.length) return;
    const i = Math.max(0, Math.min(blocks.length - 1, block));
    scroll.scrollTop = index.prefix(i); schedule();
  }
  function moveHit(direction) {
    if (!hits.length) return;
    hitPosition = (hitPosition + direction + hits.length) % hits.length;
    scrollToBlock(hits[hitPosition]);
    matches.textContent = `${hitPosition + 1}/${hits.length} 块`;
  }
  function find() {
    const query = search.value.trim().toLocaleLowerCase();
    hits = query ? blocks.flatMap((b, i) => b.text.toLocaleLowerCase().includes(query) ? [i] : []) : [];
    hitSet = new Set(hits); hitPosition = -1;
    matches.textContent = query ? '0/0 块' : '';
    moveHit(1); schedule();
  }
  const close = () => { destroy(); onClose(); };
  const onKey = event => {
    // Prevent host editor shortcuts from treating this preview as editable text.
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopImmediatePropagation(); search.focus(); search.select();
    } else if (event.key === 'Enter' && event.target === search) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = 0; find(); }
      else moveHit(event.shiftKey ? -1 : 1);
    } else if (event.composedPath().includes(host)) event.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  root.querySelector('.close').onclick = close;
  root.querySelector('.previous').onclick = () => moveHit(-1);
  root.querySelector('.next').onclick = () => moveHit(1);
  search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { searchTimer = 0; find(); }, 120); };
  scroll.addEventListener('scroll', schedule, { passive: true });
  const observer = new ResizeObserver(resize);
  observer.observe(main);
  function destroy() {
    if (destroyed) return;
    destroyed = true; cancelAnimationFrame(raf); clearTimeout(searchTimer);
    observer.disconnect(); window.removeEventListener('keydown', onKey, true);
    scroll.removeEventListener('scroll', schedule); layouts.clear(); measures.clear(); host.remove();
  }
  resize(); scroll.focus();
  return { destroy, scrollToBlock, host,
    getStats: () => ({ ...stats, blocks: blocks.length, cachedLayouts: layouts.size, cachedMeasures: measures.size,
      canvasWidth: canvas.width, canvasHeight: canvas.height, scrollTop: scroll.scrollTop,
      totalHeight: index.total, domNodes: root.querySelectorAll('*').length }) };
}
