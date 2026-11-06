import { CanvasDocument, classifyLines, inputDiff } from './editor-model.js';
import { layoutSourceLine, hitSource, caretSource, editorFont } from './editor-layout.js';
import { FormulaEngine } from './formula-client.js';
import { HeightIndex } from './height-index.js';
import { LruCache } from './layout.js';
import { BlockSearch } from './search.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function mountCanvasEditor({ markdown = '', parent = document.body, embedded = false, onChange = () => {},
  onSave = async () => {}, onClose = () => {}, resolveImage = value => value,
  theme = {}, initialDirty = false }) {
  const model = new CanvasDocument(markdown, { dirty: initialDirty });
  const host = document.createElement('div'); host.dataset.typoraCanvasEditor = '';
  Object.assign(host.style, { position: embedded ? 'absolute' : 'fixed', inset: '0', zIndex: '10', visibility: 'visible' });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
  :host{font:13px "Segoe UI","Microsoft YaHei",sans-serif;color:var(--tc-color,#243044)}*{box-sizing:border-box}
  .editor{height:100%;display:flex;flex-direction:column;background:var(--tc-bg,#fafbfd)}
  .find{display:none;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid #9aa8bb55}.find.open{display:flex}
  input,button{font:inherit;color:inherit;background:var(--tc-bg,#fff);border:1px solid #9aa8bb88;border-radius:4px;padding:5px 8px}
  input{flex:1;min-width:30px}button{cursor:pointer}button[aria-pressed=true]{background:#4c80d144}
  main{position:relative;flex:1;min-height:0;overflow:hidden}.scroll{position:absolute;inset:0;overflow:auto;overscroll-behavior:contain;overflow-anchor:none;cursor:text;touch-action:none}
  .spacer{width:1px;pointer-events:none}canvas{position:absolute;inset:0;pointer-events:none}
  textarea{position:absolute;opacity:.01;width:2px;height:28px;padding:0;border:0;resize:none;overflow:hidden;white-space:pre;caret-color:transparent;color:transparent;background:transparent;font:17px sans-serif;outline:none}
  footer{display:flex;align-items:center;gap:8px;padding:4px 12px;border-top:1px solid #9aa8bb44;font-size:11px;min-height:27px}
  .status{flex:1}.find-status{font-size:11px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  </style><section class="editor"><div class="find"><input type="search" aria-label="Canvas 正文搜索" placeholder="搜索 Markdown 原文">
  <button class="regex" aria-label="正则表达式" aria-pressed="false">.*</button><button class="prev">↑</button><button class="next">↓</button>
  <span class="find-status" role="status"></span><button class="find-close" aria-label="关闭搜索">×</button></div>
  <main><div class="scroll"><div class="spacer"></div></div><canvas aria-hidden="true"></canvas>
  <textarea aria-label="Canvas Markdown 输入" autocomplete="off" autocapitalize="off" spellcheck="false" wrap="off"></textarea></main>
  <footer><span class="status" role="status"></span><button class="save">保存 · Ctrl+S</button><button class="close">原生 · Esc</button></footer></section>`;
  host.style.setProperty('--tc-color', theme.color || '#243044');
  host.style.setProperty('--tc-bg', theme.background || '#fafbfd');
  parent.append(host);
  const main = root.querySelector('main'), scroll = root.querySelector('.scroll'), spacer = root.querySelector('.spacer');
  const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d'), input = root.querySelector('textarea');
  if (!ctx) { host.remove(); throw new Error('Canvas 2D unavailable'); }
  const status = root.querySelector('.status'), findPanel = root.querySelector('.find'), query = root.querySelector('input');
  const findStatus = root.querySelector('.find-status'), regex = root.querySelector('.regex'), search = new BlockSearch();
  const layouts = new LruCache(256), measurements = new LruCache(8192), assets = new Map();
  const formulaEngine = new FormulaEngine();
  let rows, heights, width = 0, height = 0, contentWidth = 0, left = 0, dpr = 1, raf = 0;
  let composing = false, disposed = false, focused = false, dragging = false, scope, syncingInput = false;
  let wantedX = null, searchTimer, searchEpoch = 0, hits = [], hitPosition = -1, saving = false;
  let lastPaintMs = 0, drawn = 0, assetBytes = 0, errorMessage = '', previousRaw = new Set();
  let structureRebuilds = 0;
  let previewFormulas = 0, drawnTables = 0;
  const fontSize = Math.max(12, Math.min(24, parseFloat(theme.fontSize) || 17));
  const font = theme.fontFamily || editorFont;
  const drawColor = theme.color || '#243044', background = theme.background || '#fafbfd';
  const schedule = () => { if (!raf && !disposed) raf = requestAnimationFrame(paint); };
  const activeLines = () => {
    const result = new Set();
    if (focused) {
      const first = model.doc.lineAt(model.from).number - 1, last = model.doc.lineAt(model.to).number - 1;
      for (let i = first; i <= last; i++) result.add(i);
      for (const i of [...result]) {
        const start = rows[i]?.type === 'math-tail' ? rows[i].start : i;
        if (rows[start]?.type === 'math' && rows[start].end !== undefined) for (let j = start; j <= rows[start].end; j++) result.add(j);
      }
    }
    return result;
  };
  const estimate = (i, raw = false) => {
    const row = rows[i], text = model.doc.line(i + 1).text;
    if (!raw && ['math-tail', 'table-separator'].includes(row.type)) return 0.01;
    const size = row.type === 'heading' ? Math.max(fontSize, 32 - row.level * 2) : fontSize;
    return Math.max(1, Math.ceil(text.length / Math.max(1, contentWidth / size))) * Math.ceil(size * 1.7) + 14;
  };
  function rebuild() {
    structureRebuilds++;
    rows = classifyLines(model.doc); layouts.clear();
    heights = new HeightIndex(rows.map((_, i) => estimate(i)));
    spacer.style.height = `${Math.max(height, heights.total + 48)}px`;
    previousRaw.clear();
  }
  function asset(type, source, display) {
    const key = `${type}:${display}:${source}`;
    if (assets.has(key)) { const value = assets.get(key); assets.delete(key); assets.set(key, value); return value; }
    if (assets.size >= 48) {
      const [oldKey, old] = assets.entries().next().value;
      if (old.image) { assetBytes -= old.bytes; old.image.src = ''; }
      assets.delete(oldKey);
    }
    const entry = { status: 'pending' }; assets.set(key, entry);
    (async () => {
      try {
        let url;
        if (type === 'math') {
          if (source.length > 20000) throw new Error('公式过长');
          const result = await formulaEngine.render(source, { size: fontSize, color: drawColor, display });
          url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
          entry.width = result.width; entry.height = result.height;
        } else {
          url = resolveImage(source);
          if (!/^(https?:|data:image\/|blob:|file:|typora:)/i.test(url)) throw new Error('不支持的图片地址');
        }
        const image = new Image(); image.decoding = 'async';
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片解码失败')); image.src = url; });
        if (disposed) { image.src = ''; return; }
        entry.image = image; entry.width ||= image.naturalWidth; entry.height ||= image.naturalHeight;
        entry.bytes = image.naturalWidth * image.naturalHeight * 4; assetBytes += entry.bytes;
        entry.status = 'ready';
        // Enforce both count and decoded-byte budgets. An oversized single
        // image is released and remains source text instead of consuming RAM.
        for (const [oldKey, old] of assets) {
          if (assets.size <= 48 && assetBytes <= 32 * 1024 * 1024) break;
          if (old.image) { assetBytes -= old.bytes; old.image.src = ''; delete old.image; }
          assets.delete(oldKey);
          if (oldKey === key) { entry.status = 'error'; assets.set(key, entry); break; }
        }
        layouts.clear(); schedule();
      } catch (error) {
        if (disposed) return;
        entry.status = 'error'; entry.error = String(error);
        errorMessage = `${type === 'math' ? '公式' : '图片'}渲染失败：${error.message}`;
        console.error('[Typora Canvas] asset rendering failed', error); schedule();
      }
    })();
    return entry;
  }
  function layoutKey(i, raw) {
    const line = model.doc.line(i + 1);
    const cursor = raw && (rows[i].type === 'table' || line.text.includes('$')) ? `:${model.head - line.from}:${model.anchor - line.from}` : '';
    return `${i}:${raw}:${rows[i].revision}${cursor}`;
  }
  function layout(i, rawSet = activeLines()) {
    const raw = rawSet.has(i), key = layoutKey(i, raw);
    if (!raw && ['math-tail', 'table-separator'].includes(rows[i].type)) {
      heights.update(i, .01); return { height: .01, lines: [], top: 0, lineHeight: 29 };
    }
    let value = layouts.get(key);
    if (!value) {
      const line = model.doc.line(i + 1);
      value = layoutSourceLine(ctx, line.text, rows[i], { width: contentWidth, raw, font,
        cursor: model.head - line.from, selection: { from: model.from - line.from, to: model.to - line.from },
        size: fontSize, asset, measure: (f, text) => {
          const key = `${f}\0${text}`; let w = measurements.get(key);
          if (w === undefined) { ctx.font = f; w = measurements.set(key, ctx.measureText(text).width); }
          return w;
        } });
      layouts.set(key, value);
    }
    heights.update(i, Math.max(.01, value.height));
    return value;
  }
  function caretBox() {
    const line = model.doc.lineAt(model.head), i = line.number - 1, local = model.head - line.from;
    const value = layout(i);
    const caret = caretSource(value, local);
    return { x: left + caret.x, y: heights.prefix(i) + caret.y, height: caret.height, i };
  }
  function syncInput() {
    if (composing || disposed) return;
    const first = model.doc.lineAt(model.from), last = model.doc.lineAt(model.to);
    scope = { from: first.from, to: last.to, text: model.doc.sliceString(first.from, last.to) };
    syncingInput = true;
    input.value = scope.text;
    input.setSelectionRange(model.from - scope.from, model.to - scope.from, model.head < model.anchor ? 'backward' : 'forward');
    syncingInput = false;
  }
  function revealCaret() {
    const caret = caretBox();
    spacer.style.height = `${Math.max(height, heights.total + 48)}px`;
    if (caret.y < scroll.scrollTop + 12) scroll.scrollTop = Math.max(0, caret.y - 12);
    else if (caret.y + caret.height > scroll.scrollTop + height - 12) scroll.scrollTop = caret.y + caret.height - height + 12;
    input.style.left = `${Math.max(0, Math.min(width - 3, caret.x))}px`;
    input.style.top = `${Math.max(0, Math.min(height - 28, caret.y - scroll.scrollTop))}px`;
  }
  function changed(change = null) {
    errorMessage = '';
    if (!change || change.addedLines || change.first !== change.last || /[\n$`~|]/.test(change.inserted + change.deleted) ||
        /^\s*[| :\-]+$/.test(model.doc.line(change.first + 1).text)) rebuild();
    else {
      const i = change.first, old = rows[i];
      const next = classifyLines({ lines: 1, line: () => model.doc.line(i + 1) })[0];
      rows[i] = ['code', 'table'].includes(old.type) ? { ...old, revision: old.revision + 1 } : { ...next, revision: old.revision + 1 };
      heights.update(i, estimate(i, true));
    }
    hits = []; searchEpoch++; search.cancel();
    onChange(model); syncInput(); revealCaret(); schedule();
  }
  function setSelection(anchor, head = anchor, reveal = true) {
    model.select(anchor, head); syncInput(); if (reveal) revealCaret(); schedule();
  }
  function resize() {
    const nextWidth = Math.max(1, main.clientWidth), nextHeight = Math.max(1, main.clientHeight);
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
    const oldLine = heights?.find(scroll.scrollTop) || 0;
    const widthChanged = nextWidth !== width;
    width = nextWidth; height = nextHeight; dpr = nextDpr;
    canvas.width = Math.ceil(width * dpr); canvas.height = Math.ceil(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    contentWidth = Math.max(40, Math.min(900, scroll.clientWidth - 48)); left = Math.max(16, (scroll.clientWidth - contentWidth) / 2);
    if (!heights || widthChanged) { rebuild(); scroll.scrollTop = heights.prefix(Math.min(oldLine, rows.length - 1)); }
    schedule();
  }
  function paint() {
    raf = 0; if (disposed || !heights) return;
    const started = performance.now(), rawSet = activeLines();
    const anchor = heights.find(scroll.scrollTop), within = scroll.scrollTop - heights.prefix(anchor);
    for (const i of new Set([...rawSet, ...previousRaw])) if (i < rows.length && rawSet.has(i) !== previousRaw.has(i)) heights.update(i, estimate(i, rawSet.has(i)));
    previousRaw = rawSet;
    const first = heights.find(Math.max(0, scroll.scrollTop - 300));
    let deferred = false;
    for (let i = first; i < rows.length && heights.prefix(i) < scroll.scrollTop + height + 300; i++) {
      layout(i, rawSet);
      if (performance.now() - started > 8) { deferred = true; break; }
    }
    spacer.style.height = `${Math.max(height, heights.total + 48)}px`;
    scroll.scrollTop = heights.prefix(anchor) + Math.min(within, Math.max(0, heights.values[anchor] - 1));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, scroll.clientWidth, height); ctx.clip(); drawn = 0; previewFormulas = 0; drawnTables = 0;
    for (let i = heights.find(scroll.scrollTop); i < rows.length; i++) {
      const y = heights.prefix(i) - scroll.scrollTop; if (y > height) break;
      const value = layouts.get(layoutKey(i, rawSet.has(i))); if (!value) continue;
      drawn++;
      const line = model.doc.line(i + 1), row = rows[i];
      if (row.type === 'code') { ctx.fillStyle = '#8997b318'; ctx.fillRect(left - 8, y, contentWidth + 16, value.height); }
      if (row.type === 'quote') { ctx.fillStyle = '#7393bd'; ctx.fillRect(left - 10, y, 3, value.height); }
      if (value.cells) {
        drawnTables++;
        if (row.header) { ctx.fillStyle = '#8997b322'; ctx.fillRect(left, y, contentWidth, value.height); }
        ctx.strokeStyle = '#8997b388'; ctx.lineWidth = 1;
        ctx.strokeRect(left, y, contentWidth, value.height);
        for (let c = 1; c < row.columns; c++) {
          ctx.beginPath(); ctx.moveTo(left + c * value.cellWidth, y); ctx.lineTo(left + c * value.cellWidth, y + value.height); ctx.stroke();
        }
      }
      if (hits.includes(i)) { ctx.fillStyle = '#e9b94933'; ctx.fillRect(left - 8, y, contentWidth + 16, value.height); }
      if (value.media?.image) {
        if (row.type === 'math') previewFormulas++;
        ctx.drawImage(value.media.image, left, y + value.top, value.mediaWidth, value.mediaHeight);
      }
      for (const visual of value.lines) for (const p of visual.pieces) {
        if (line.from + p.to > model.from && line.from + p.from < model.to) {
          ctx.fillStyle = '#609bf166'; ctx.fillRect(left + p.x, y + visual.top, Math.max(2, p.width), visual.height);
        }
        if (p.media?.image) { previewFormulas++; ctx.drawImage(p.media.image, left + p.x, y + visual.top, p.width, p.height); }
        else { ctx.font = p.font; ctx.fillStyle = p.link ? '#4c80d1' : drawColor;
          ctx.fillText(p.text, left + p.x, y + visual.top + visual.height * .8); }
      }
    }
    if (focused && model.from === model.to) {
      const caret = caretBox(); ctx.fillStyle = drawColor;
      ctx.fillRect(caret.x, caret.y - scroll.scrollTop, 1.5, caret.height);
      input.style.left = `${Math.max(0, Math.min(width - 3, caret.x))}px`;
      input.style.top = `${Math.max(0, Math.min(height - 28, caret.y - scroll.scrollTop))}px`;
    }
    ctx.restore(); lastPaintMs = performance.now() - started;
    const line = model.doc.lineAt(model.head);
    status.textContent = errorMessage || `Canvas 编辑${model.dirty ? ' · 未保存' : ''} · ${line.number}:${model.head - line.from + 1} · 绘制 ${drawn}/${rows.length} 行 · ${lastPaintMs.toFixed(1)}ms`;
    if (deferred) schedule();
  }
  function hit(x, y) {
    const i = heights.find(Math.max(0, y));
    const value = layout(i), line = model.doc.line(i + 1);
    return line.from + hitSource(value, x - left, y - heights.prefix(i), line.text.length);
  }
  const pointer = event => {
    if (event.button !== 0 || event.offsetX >= scroll.clientWidth) return;
    const r = main.getBoundingClientRect();
    const position = hit(event.clientX - r.left, event.clientY - r.top + scroll.scrollTop);
    event.preventDefault(); focused = true; dragging = true;
    setSelection(event.shiftKey ? model.anchor : position, position, false);
    input.focus({ preventScroll: true }); scroll.setPointerCapture(event.pointerId);
  };
  const pointerMove = event => {
    if (!dragging) return;
    const r = main.getBoundingClientRect(), y = event.clientY - r.top;
    if (y < 20) scroll.scrollTop -= 24; else if (y > height - 20) scroll.scrollTop += 24;
    setSelection(model.anchor, hit(event.clientX - r.left, y + scroll.scrollTop), false);
  };
  const pointerUp = () => { dragging = false; };
  const onInput = () => {
    if (syncingInput || !scope) return;
    const diff = inputDiff(scope.text, input.value);
    const base = scope.from;
    const change = model.replace(base + diff.from, base + diff.to, diff.text, {
      anchor: base + (input.selectionDirection === 'backward' ? input.selectionEnd : input.selectionStart),
      head: base + (input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd)
    });
    scope.text = input.value; scope.to = base + scope.text.length;
    changed(change);
  };
  async function save() {
    if (saving) return; saving = true;
    const snapshot = model.doc;
    try { await onSave(model.getText()); model.markSaved(snapshot); errorMessage = ''; }
    catch (error) { errorMessage = `保存失败：${error.message}`; }
    finally { saving = false; schedule(); }
  }
  const moveHorizontal = (direction, extend) => {
    let next;
    if (!extend && model.from !== model.to) next = direction < 0 ? model.from : model.to;
    else {
      const line = model.doc.lineAt(model.head), local = model.head - line.from;
      const stops = [...graphemes.segment(line.text)].map(p => p.index); stops.push(line.text.length);
      if (direction < 0) next = line.from + (stops.filter(p => p < local).at(-1) ?? -1);
      else next = line.from + (stops.find(p => p > local) ?? line.text.length + 1);
    }
    wantedX = null; setSelection(extend ? model.anchor : next, next);
  };
  const onKey = event => {
    if (!event.composedPath().includes(host)) return;
    event.stopImmediatePropagation();
    if (composing || event.isComposing || event.keyCode === 229) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (mod && key === 's') { event.preventDefault(); save(); return; }
    if (mod && key === 'f') { event.preventDefault(); findPanel.classList.add('open'); query.focus(); query.select(); return; }
    if (event.target === host && event.composedPath()[0] === query) {
      if (event.key === 'Enter') { event.preventDefault(); moveHit(event.shiftKey ? -1 : 1); }
      else if (event.key === 'Escape') { event.preventDefault(); closeFind(); }
      return;
    }
    if (key === 'escape') { event.preventDefault(); if (findPanel.classList.contains('open')) closeFind(); else onClose(); return; }
    if (mod && key === 'a') { event.preventDefault(); setSelection(0, model.length); return; }
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault(); if ((key === 'y' || event.shiftKey) ? model.redo() : model.undo()) changed(); return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); moveHorizontal(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey); return; }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault(); const caret = caretBox(); wantedX ??= caret.x;
      const next = hit(wantedX, caret.y + (event.key === 'ArrowUp' ? -caret.height / 2 : caret.height * 1.5));
      setSelection(event.shiftKey ? model.anchor : next, next); return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); const line = model.doc.lineAt(model.head);
      const next = event.key === 'Home' ? mod ? 0 : line.from : mod ? model.length : line.to;
      wantedX = null; setSelection(event.shiftKey ? model.anchor : next, next); return;
    }
    if (event.key === 'Tab') { event.preventDefault(); changed(model.replaceSelection('  ')); return; }
    if (event.key === 'Backspace' && model.from === model.to && model.head > 0 && model.head === model.doc.lineAt(model.head).from) {
      event.preventDefault(); changed(model.replace(model.head - 1, model.head, '')); return;
    }
    if (event.key === 'Delete' && model.from === model.to && model.head < model.length && model.head === model.doc.lineAt(model.head).to) {
      event.preventDefault(); changed(model.replace(model.head, model.head + 1, '')); return;
    }
  };
  function closeFind() { findPanel.classList.remove('open'); input.focus({ preventScroll: true }); }
  function moveHit(direction) {
    if (!hits.length) return;
    hitPosition = (hitPosition + direction + hits.length) % hits.length;
    const i = hits[hitPosition];
    scroll.scrollTop = heights.prefix(i); findStatus.textContent = `${hitPosition + 1}/${hits.length} 行`; schedule();
  }
  async function find() {
    const epoch = ++searchEpoch; findStatus.textContent = '搜索中…';
    try {
      const result = await search.search([...model.doc.iterLines()], query.value, { regex: regex.getAttribute('aria-pressed') === 'true' });
      if (disposed || epoch !== searchEpoch) return;
      hits = result.blocks; hitPosition = -1; findStatus.textContent = hits.length ? '' : '0/0 行'; moveHit(1); schedule();
    } catch (error) { if (!disposed && epoch === searchEpoch) findStatus.textContent = `搜索错误：${error.message}`; }
  }
  const events = [
    [window, 'keydown', onKey, true], [scroll, 'pointerdown', pointer, false], [scroll, 'pointermove', pointerMove, false],
    [scroll, 'pointerup', pointerUp, false], [scroll, 'pointercancel', pointerUp, false], [scroll, 'scroll', schedule, { passive: true }],
    [input, 'input', onInput, false],
    [input, 'focus', () => { focused = true; schedule(); }, false], [input, 'blur', () => { focused = false; schedule(); }, false],
    [input, 'compositionstart', () => { composing = true; model.beginGroup(); }, false],
    [input, 'compositionend', () => { composing = false; setTimeout(() => { if (!disposed) { model.endGroup(); syncInput(); schedule(); } }, 0); }, false],
    [input, 'copy', event => { event.preventDefault(); event.clipboardData?.setData('text/plain', model.doc.sliceString(model.from, model.to)); }, false],
    [input, 'cut', event => { event.preventDefault(); event.clipboardData?.setData('text/plain', model.doc.sliceString(model.from, model.to)); changed(model.replaceSelection('')); }, false],
    [input, 'paste', event => { event.preventDefault(); changed(model.replaceSelection(event.clipboardData?.getData('text/plain') || '')); }, false]
  ];
  events.forEach(([el, name, fn, options]) => el.addEventListener(name, fn, options));
  root.querySelector('.save').onclick = save; root.querySelector('.close').onclick = onClose;
  root.querySelector('.find-close').onclick = closeFind;
  root.querySelector('.next').onclick = () => moveHit(1); root.querySelector('.prev').onclick = () => moveHit(-1);
  regex.onclick = () => { regex.setAttribute('aria-pressed', String(regex.getAttribute('aria-pressed') !== 'true')); find(); };
  query.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(find, 120); };
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(main);
  resize(); syncInput(); input.focus({ preventScroll: true });
  return { host, model, getText: () => model.getText(), save,
    setStatus: message => { errorMessage = message; schedule(); },
    scrollToLine: i => { scroll.scrollTop = heights.prefix(Math.max(0, Math.min(rows.length - 1, i))); schedule(); },
    getStats: () => ({ mode: 'canvas-editor', lines: rows.length, drawnLines: drawn, cachedLayouts: layouts.size,
      domNodes: root.querySelectorAll('*').length, canvasWidth: canvas.width, canvasHeight: canvas.height,
      paintMs: lastPaintMs, dirty: model.dirty, assets: assets.size, readyAssets: [...assets.values()].filter(a => a.image).length,
      assetBytes, previewFormulas, drawnTables, failedAssets: [...assets.values()].filter(a => a.status === 'error').length,
      structureRebuilds, selection: model.selection,
      scopedInputLength: input.value.length }), destroy() {
      if (disposed) return; disposed = true; cancelAnimationFrame(raf); clearTimeout(searchTimer); search.cancel(); resizeObserver.disconnect();
      events.forEach(([el, name, fn, options]) => el.removeEventListener(name, fn, options));
      formulaEngine.destroy();
      for (const entry of assets.values()) if (entry.image) entry.image.src = '';
      assets.clear(); layouts.clear(); measurements.clear(); host.remove();
    } };
}
