import { toCanvas } from 'html-to-image';

// Typora owns the document, layout, formula renderer and selection at all times.
// Cached blocks remain in the hit-testing/accessibility tree (opacity, not display).
// Every interaction restores the original DOM synchronously before the event's
// default action, so native caret placement, IME, undo and links still work.
export function mountHybrid({ content, write, idleDelay = 250, cacheBytes = 24 * 1024 * 1024 }) {
  if (!content || !write) throw new Error('Typora content / #write is not ready');
  const host = document.createElement('div');
  host.dataset.typoraCanvasHybrid = '';
  Object.assign(host.style, { position: 'fixed', pointerEvents: 'none', zIndex: '5', overflow: 'hidden' });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{pointer-events:none}canvas{position:absolute;inset:0;pointer-events:none}
    button{position:absolute;right:18px;bottom:6px;pointer-events:auto;border:1px solid #8895a455;
    border-radius:4px;background:var(--bg-color,#fff);color:var(--text-color,#555);font:11px sans-serif;
    opacity:.8;padding:3px 6px;cursor:pointer}</style><canvas aria-hidden="true"></canvas>
    <button type="button" aria-label="Canvas 渲染状态" title="默认自动运行；点击切换缓存与原生交互，输入时自动交给 Typora"></button>`;
  content.append(host);
  const canvas = shadow.querySelector('canvas'), ctx = canvas.getContext('2d');
  if (!ctx) { host.remove(); throw new Error('Canvas 2D unavailable'); }
  const badge = shadow.querySelector('button');
  const style = document.createElement('style');
  style.textContent = `#write.tc-hybrid-idle > [data-tc-block]:not(.tc-hybrid-visible){content-visibility:auto;contain-intrinsic-size:auto 120px}
    #write > .tc-hybrid-cached{opacity:0!important}
    @media print { #write.tc-hybrid-idle > [data-tc-block]{content-visibility:visible;contain-intrinsic-size:none}
      #write > .tc-hybrid-cached{opacity:revert!important} [data-typora-canvas-hybrid]{display:none!important} }`;
  document.head.append(style);
  const cache = new Map(), visible = new Set(), observed = new Set(), hidden = new Set();
  const ownClass = new WeakMap();
  let failedBlocks = new WeakSet();
  const hadIdleClass = write.classList.contains('tc-hybrid-idle');
  const priorBlocks = new Map();
  const priorVisible = new WeakSet();
  let totalBytes = 0, generation = 0, timer = null, raf = 0, running = false, disposed = false;
  let editing = false, composing = false, state = '准备', lastError = '', captures = 0, fallbacks = 0;
  let invalidations = 0, lastInvalidation = '';
  let lastMismatch = '';
  let rect, dpr = 1, activeCapture = null;
  const setClass = (el, name, enabled) => {
    el.classList.toggle(name, enabled);
    if (el.getAttribute('class') === '') el.removeAttribute('class');
    ownClass.set(el, el.getAttribute('class'));
  };
  const markState = value => {
    state = value;
    document.documentElement.dataset.typoraCanvasState = `hybrid:${value}`;
    badge.textContent = `Canvas · ${value}${hidden.size ? ` ${hidden.size}` : ''}`;
    badge.title = lastError ? `部分内容保留原生显示：${lastError}` : '原生公式、CSS 与编辑始终保留；点击切换缓存 / 原生交互';
  };
  const restore = () => {
    for (const el of hidden) setClass(el, 'tc-hybrid-cached', false);
    hidden.clear();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  const cancel = () => { generation++; clearTimeout(timer); cancelAnimationFrame(raf); raf = 0; };
  function suspend(reason = '编辑') {
    if (disposed) return;
    cancel(); editing = true; restore(); setClass(write, 'tc-hybrid-idle', false); markState(reason);
  }
  function release(entry) { if (entry.failed) return; totalBytes -= entry.bytes; entry.image.width = 0; entry.image.height = 0; }
  function clearCache() { for (const entry of cache.values()) release(entry); cache.clear(); failedBlocks = new WeakSet(); }
  function invalidate(reason = 'document') {
    if (disposed) return;
    invalidations++; lastInvalidation = typeof reason === 'string' ? reason : reason?.type || 'document';
    cancel(); restore(); clearCache(); schedule();
  }
  const resize = () => {
    const next = content.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const changed = !rect || rect.width !== next.width || rect.height !== next.height || dpr !== scale;
    rect = next; dpr = scale;
    Object.assign(host.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${content.clientWidth}px`, height: `${content.clientHeight}px` });
    if (changed) {
      canvas.width = Math.max(1, Math.ceil(content.clientWidth * dpr));
      canvas.height = Math.max(1, Math.ceil(content.clientHeight * dpr));
      canvas.style.width = `${content.clientWidth}px`; canvas.style.height = `${content.clientHeight}px`;
      invalidate('resize');
    }
  };
  function draw() {
    if (disposed || editing) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const el of [...hidden]) {
      const entry = cache.get(el);
      if (!el.isConnected || !entry) { setClass(el, 'tc-hybrid-cached', false); hidden.delete(el); continue; }
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - entry.width) > 0.5 || Math.abs(r.height - entry.height) > 0.5) {
        lastMismatch = `${el.tagName} ${r.width}x${r.height} / ${entry.width}x${entry.height}`;
        setClass(el, 'tc-hybrid-cached', false); hidden.delete(el); cache.delete(el); release(entry); continue;
      }
      if (r.bottom >= rect.top && r.top <= rect.bottom) ctx.drawImage(entry.image, r.left - rect.left, r.top - rect.top, r.width, r.height);
    }
    markState(hidden.size ? '缓存' : '原生');
  }
  function schedule() {
    if (disposed || editing || composing) return;
    clearTimeout(timer); timer = setTimeout(captureVisible, idleDelay);
  }
  function eligible(el, r) {
    // Complex content stays native: there is no second formula/parser pipeline,
    // no placeholders and no speculative recreation of Typora extensions.
    if (r.width <= 0 || r.height <= 0 || r.width * r.height * dpr * dpr * 4 > cacheBytes / 2) return false;
    if (el.querySelector('mjx-container, math, svg, img, video, canvas, iframe, input, textarea, .CodeMirror, .md-fences') ||
        el.matches('.md-fences, .md-math-block, .md-diagram, [contenteditable="false"]')) return false;
    const cs = getComputedStyle(el);
    if (cs.transform !== 'none' || cs.filter !== 'none' || cs.boxShadow !== 'none' || cs.animationName !== 'none' ||
        cs.mixBlendMode !== 'normal' || cs.backgroundImage.includes('url(')) return false;
    // SVG foreignObject cannot reuse an external @font-face implicitly.
    // Leave those blocks native rather than silently substituting a font.
    const families = cs.fontFamily.toLowerCase();
    for (const font of document.fonts || []) {
      if (families.includes(font.family.replace(/["']/g, '').toLowerCase())) return false;
    }
    return true;
  }
  async function captureVisible() {
    timer = null;
    if (disposed || editing || composing) return;
    if (running) { schedule(); return; }
    running = true;
    const epoch = generation;
    try {
      setClass(write, 'tc-hybrid-idle', true);
      for (const el of visible) {
        if (epoch !== generation || disposed || editing) break;
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom < rect.top || r.top > rect.bottom) continue;
        let entry = cache.get(el);
        if (failedBlocks.has(el)) continue;
        if (!entry) {
          if (!eligible(el, r)) continue;
          activeCapture = el;
          try {
            const image = await toCanvas(el, { width: r.width, height: r.height, pixelRatio: dpr,
              skipFonts: true, style: { margin: '0', contentVisibility: 'visible', containIntrinsicSize: 'none' } });
            if (disposed || epoch !== generation || editing || !el.isConnected) {
              image.width = 0; image.height = 0; break;
            }
            entry = { image, width: r.width, height: r.height, bytes: image.width * image.height * 4 };
            // Byte bound, not only an entry count: big tables can be expensive.
            for (const [oldEl, oldEntry] of cache) {
              if (totalBytes + entry.bytes <= cacheBytes && cache.size < 128) break;
              if (hidden.has(oldEl)) { setClass(oldEl, 'tc-hybrid-cached', false); hidden.delete(oldEl); }
              cache.delete(oldEl); if (!oldEntry.failed) release(oldEntry);
            }
            cache.set(el, entry); totalBytes += entry.bytes; captures++;
          } catch (error) {
            if (epoch !== generation || disposed) break;
            lastError = String(error); fallbacks++;
            failedBlocks.add(el); continue;
          } finally { activeCapture = null; }
        }
        // Hide only after a valid bitmap is available; restore on any mutation.
        hidden.add(el); setClass(el, 'tc-hybrid-cached', true); draw();
      }
    } finally { running = false; }
  }
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      setClass(entry.target, 'tc-hybrid-visible', entry.isIntersecting || priorVisible.has(entry.target));
      if (entry.isIntersecting) visible.add(entry.target);
      else { visible.delete(entry.target); if (hidden.delete(entry.target)) setClass(entry.target, 'tc-hybrid-cached', false); }
    }
    schedule();
  }, { root: content, rootMargin: '400px' });
  function reconcile() {
    const children = new Set(write.children);
    for (const el of observed) if (!children.has(el)) {
      intersection.unobserve(el); observed.delete(el); visible.delete(el);
      if (!priorVisible.has(el)) setClass(el, 'tc-hybrid-visible', false);
      if (hidden.delete(el)) setClass(el, 'tc-hybrid-cached', false);
      const entry = cache.get(el); if (entry && !entry.failed) release(entry); cache.delete(el);
      if (priorBlocks.get(el) === null) el.removeAttribute('data-tc-block');
      else if (priorBlocks.has(el)) el.setAttribute('data-tc-block', priorBlocks.get(el));
      priorBlocks.delete(el);
    }
    for (const el of children) if (!observed.has(el)) {
      if (el.classList.contains('tc-hybrid-visible')) priorVisible.add(el);
      priorBlocks.set(el, el.getAttribute('data-tc-block'));
      el.setAttribute('data-tc-block', ''); observed.add(el); intersection.observe(el);
    }
  }
  const mutations = new MutationObserver(records => {
    const real = records.some(m => {
      if (m.type === 'attributes' && m.attributeName === 'data-tc-block') return false;
      if (m.type === 'attributes' && m.attributeName === 'class' && ownClass.has(m.target) &&
          ownClass.get(m.target) === m.target.getAttribute('class')) return false;
      return true;
    });
    if (real) { reconcile(); invalidate(`mutation:${records.map(m => `${m.type}/${m.attributeName || ''}/${m.target.nodeName}`).join(',').slice(0, 200)}`); }
  });
  const themeObserver = new MutationObserver(() => invalidate('theme'));
  const resizeObserver = new ResizeObserver(resize);
  const onScroll = () => {
    if (!editing && !disposed) {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; resize(); draw(); });
      schedule();
    }
  };
  const insideEditor = target => target instanceof Node && write.contains(target);
  const interaction = event => {
    if (insideEditor(event.target)) suspend('编辑');
    else if (!host.contains(event.target)) {
      cancel(); restore(); editing = false; schedule();
    }
  };
  const onKey = event => {
    // Ctrl+F is deliberately not intercepted: Typora's native regex search and
    // replace operate on the real document, including formulas / source syntax.
    if (insideEditor(event.target) || ((event.ctrlKey || event.metaKey) && /^(f|h)$/i.test(event.key))) suspend('编辑');
  };
  const onFocus = event => { if (insideEditor(event.target)) suspend('编辑'); };
  const onBlur = () => setTimeout(() => {
    if (!disposed && !insideEditor(document.activeElement)) { editing = false; schedule(); }
  }, 0);
  const onCompositionStart = () => { composing = true; suspend('输入'); };
  const onCompositionEnd = () => { composing = false; invalidate(); };
  const onBeforePrint = () => suspend('打印');
  const onSelection = () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && insideEditor(selection.anchorNode)) suspend('选择');
  };
  const onAfterPrint = () => { editing = false; schedule(); };
  const events = [
    [document, 'pointerdown', interaction, true], [document, 'keydown', onKey, true],
    [document, 'selectionchange', onSelection, false],
    [write, 'beforeinput', () => suspend('编辑'), true], [write, 'input', invalidate, false],
    [write, 'focusin', onFocus, false], [write, 'focusout', onBlur, false],
    [write, 'compositionstart', onCompositionStart, true], [write, 'compositionend', onCompositionEnd, true],
    [write, 'load', invalidate, true], [content, 'scroll', onScroll, { passive: true }],
    [window, 'resize', resize, false], [window, 'beforeprint', onBeforePrint, false], [window, 'afterprint', onAfterPrint, false]
  ];
  events.forEach(([target, name, fn, options]) => target.addEventListener(name, fn, options));
  badge.onclick = () => { if (editing) { editing = false; markState('准备'); schedule(); } else suspend('编辑'); };
  reconcile();
  mutations.observe(write, { attributes: true, characterData: true, childList: true, subtree: true });
  themeObserver.observe(document.head, { attributes: true, characterData: true, childList: true, subtree: true });
  // Class/style changes on the shell carry theme switches; watch no document text.
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  resizeObserver.observe(content); resizeObserver.observe(write);
  resize(); markState('准备'); schedule();
  return { host, invalidate, suspend, getStats: () => ({ state, cachedBlocks: cache.size, hiddenBlocks: hidden.size,
    cacheBytes: totalBytes, captures, fallbacks, invalidations, lastInvalidation, lastMismatch, activeCapture: !!activeCapture }), destroy() {
    if (disposed) return;
    disposed = true; cancel(); mutations.disconnect(); intersection.disconnect(); themeObserver.disconnect(); resizeObserver.disconnect();
    events.forEach(([target, name, fn, options]) => target.removeEventListener(name, fn, options));
    restore(); clearCache();
    setClass(write, 'tc-hybrid-idle', hadIdleClass);
    for (const [el, value] of priorBlocks) {
      if (!priorVisible.has(el)) setClass(el, 'tc-hybrid-visible', false);
      if (value === null) el.removeAttribute('data-tc-block'); else el.setAttribute('data-tc-block', value);
    }
    host.remove(); style.remove(); document.documentElement.dataset.typoraCanvasState = 'disabled';
  } };
}
