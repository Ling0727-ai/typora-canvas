import { CanvasDocument, classifyLines, inputDiff } from './editor-model.js';
import { layoutSourceLine, hitSource, caretSource, editorFont } from './editor-layout.js';
import { FormulaEngine } from './formula-client.js';
import { defaultCalloutTheme, calloutSpec } from './callouts.js';
import { watchCanvasTheme } from './theme.js';
import { HeightIndex } from './height-index.js';
import { LruCache } from './layout.js';
import { BlockSearch } from './search.js';
import { tableContext as findTableContext, cellRange, editTable, tableSource } from './table-commands.js';
import { mountTableToolbar, TABLE_TOOLS_HEIGHT } from './table-toolbar.js';
import { CodeHighlighter, languageLabel } from './code-client.js';
import { mountCodeUI } from './code-ui.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function mountCanvasEditor({ markdown = '', parent = document.body, embedded = false, onChange = () => {},
  onSave = async () => {}, onClose = () => {}, resolveImage = value => value,
  theme = {}, initialDirty = false, getTheme = null, themeNodes = [], nativeCallouts = null }) {
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
  const highlighter = new CodeHighlighter(), codeCache = new Map();
  const calloutCache = new Map(); let calloutBytes = 0, drawnNativeCallouts = 0;
  let rows, heights, width = 0, height = 0, contentWidth = 0, left = 0, dpr = 1, raf = 0;
  let composing = false, disposed = false, focused = false, dragging = false, scope, syncingInput = false;
  let wantedX = null, searchTimer, searchEpoch = 0, hits = [], hitPosition = -1, saving = false;
  let lastPaintMs = 0, drawn = 0, assetBytes = 0, errorMessage = '', previousRaw = new Set();
  let structureRebuilds = 0;
  let previewFormulas = 0, drawnTables = 0;
  let fontSize = Math.max(6, parseFloat(theme.fontSize) || 17);
  let font = theme.fontFamily || editorFont;
  let drawColor = theme.color || '#243044', background = theme.background || '#fafbfd';
  let calloutTheme = theme.callouts || defaultCalloutTheme();
  let openCallouts = new Set(), hoverCallouts = new Set();
  let searchCallouts = new Set(), assetEpoch = 0;
  const foldOverrides = new Map();
  let tableSelection = null, tableToolbarStart = -1;
  const tableUI = mountTableToolbar(main, { action: runTableAction, focusEditor: () => input.focus({ preventScroll: true }) });
  let codeSelection = null, typography = theme.typography || {}, codeStyle = theme.code || {};
  let containerStyle = theme.container || { maxWidth: 948, paddingLeft: 24, paddingRight: 24, paddingTop: 0, paddingBottom: 48 };
  let tableStyle = theme.table || { headerBackground: '#8997b322', oddBackground: 'transparent', evenBackground: 'transparent',
    borderColor: '#8997b388', horizontalBorderWidth: 1, verticalBorderWidth: 1 };
  const codeUI = mountCodeUI(main, { choose: chooseLanguage, focusEditor: () => input.focus({ preventScroll: true }) });
  const schedule = () => { if (!raf && !disposed) raf = requestAnimationFrame(paint); };
  const activeLines = () => {
    const result = new Set();
    if (focused) {
      const first = model.doc.lineAt(model.from).number - 1, last = model.doc.lineAt(model.to).number - 1;
      for (let i = first; i <= last; i++) result.add(i);
      for (const i of [...result]) {
        const start = rows[i]?.type === 'math-tail' ? rows[i].start : i;
        const group = rows[start];
        if (group?.type === 'math' && group.end !== undefined) {
          const atBoundary = model.from === model.to && (i === start && model.head === model.doc.line(i + 1).from ||
            i === group.end && model.head === model.doc.line(i + 1).to);
          if (atBoundary) result.delete(i);
          else for (let j = start; j <= group.end; j++) result.add(j);
        }
      }
      if (nativeCallouts) for (const i of [...result]) {
        const group = rows[i]?.callouts?.[0];
        if (!group) continue;
        const line = model.doc.line(i + 1), boundary = i === group.start && model.from === model.to &&
          (model.head === line.from || model.head === line.to);
        if (boundary) result.delete(i);
        else for (let j = group.start; j <= group.end; j++) result.add(j);
      }
    }
    return result;
  };
  const collapsed = group => foldOverrides.has(group.id) ? foldOverrides.get(group.id) : group.fold === '-';
  function hiddenCallout(row) {
    return row.callouts?.some(group => group.start !== row.sourceLine && collapsed(group) && !openCallouts.has(group.id));
  }
  function effectiveOpenCallouts(rawSet) {
    const result = new Set([...hoverCallouts, ...searchCallouts]);
    for (const i of rawSet) for (const group of rows[i]?.callouts || []) {
      const line = model.doc.line(i + 1), cursor = model.head - line.from;
      if (i !== group.start || cursor > 0 && cursor < line.text.length) result.add(group.id);
    }
    return result;
  }
  function updateOpenCallouts(rawSet) {
    const next = effectiveOpenCallouts(rawSet);
    const changed = new Set([...openCallouts, ...next].filter(id => next.has(id) !== openCallouts.has(id)));
    openCallouts = next;
    if (changed.size && heights) {
      for (const group of rows.calloutGroups || []) if (changed.has(group.id)) {
        for (let i = group.start; i <= group.end; i++) heights.update(i, estimate(i, rawSet.has(i)));
      }
    }
  }
  const estimate = (i, raw = false) => {
    const row = rows[i], text = model.doc.line(i + 1).text;
    if (hiddenCallout(row)) return .01;
    if (!raw && row.type === 'blank') return .01 + (i === 0 ? containerStyle.paddingTop || 0 : 0);
    if (!raw && ['math-tail', 'table-separator'].includes(row.type)) return 0.01;
    const size = row.type === 'heading' ? Math.max(fontSize, 32 - row.level * 2) : fontSize;
    return Math.max(1, Math.ceil(text.length / Math.max(1, contentWidth / size))) * Math.ceil(size * 1.7) + 14 + (i === tableToolbarStart ? TABLE_TOOLS_HEIGHT : 0) + (i === 0 ? containerStyle.paddingTop || 0 : 0);
  };
  function refreshTableSelection(adjustHeights = true) {
    const previous = tableToolbarStart;
    tableSelection = findTableContext(model.doc, rows, model.head, model.anchor);
    tableToolbarStart = tableSelection?.start ?? -1;
    if (!tableSelection) tableUI.update(null);
    if (adjustHeights && heights && previous !== tableToolbarStart) {
      for (const i of [previous, tableToolbarStart]) if (i >= 0 && i < heights.length && i < rows.length) heights.update(i, estimate(i));
    }
  }
  async function runTableAction(action, options) {
    if (composing) return;
    try {
      if (action === 'copy') {
        await navigator.clipboard.writeText(tableSource(model.doc, rows, model.head, model.anchor));
        errorMessage = '表格已复制'; schedule(); return;
      }
      const change = editTable(model, rows, action, options);
      if (change) changed(change);
    } catch (error) { errorMessage = error.message; schedule(); }
  }
  function focusCell(row, column, select = true) {
    refreshTableSelection(); if (!tableSelection) return;
    const range = cellRange(model.doc, rows, tableSelection, row, column);
    setSelection(range.from, select ? range.to : range.from);
  }
  function navigateTable(direction, vertical = false) {
    refreshTableSelection(); const context = tableSelection; if (!context) return false;
    let row = context.row, column = context.column;
    if (vertical) row++;
    else {
      column += direction;
      if (column >= context.columns) { column = 0; row++; }
      if (column < 0) { column = context.columns - 1; row--; }
    }
    if (row < 0) { setSelection(model.doc.line(context.start + 1).from); return true; }
    if (row >= context.rowCount) {
      runTableAction('insert-row-below'); refreshTableSelection();
      row = tableSelection.row; // The operation selects the inserted row.
    }
    focusCell(row, column); return true;
  }
  function exitTable() {
    refreshTableSelection(); const context = tableSelection; if (!context) return;
    const last = model.doc.line(context.end + 1), prefix = last.text.slice(0, rows[context.end].sourceOffset || 0);
    const eol = last.text.endsWith('\r') ? '\r\n' : '\n';
    if (last.to < model.length) {
      const next = model.doc.line(context.end + 2);
      if (next.text.replace(/\r$/, '') === prefix.trimEnd() || next.text.replace(/\r$/, '') === prefix) {
        setSelection(next.from + Math.min(prefix.length, next.text.length));
      } else changed(model.replace(next.from, next.from, prefix + eol, { anchor: next.from + prefix.length, head: next.from + prefix.length }));
    } else changed(model.replace(last.to, last.to, eol + prefix));
  }
  function refreshCodeSelection() {
    const i = model.doc.lineAt(model.head).number - 1, row = rows[i];
    codeSelection = row?.codeStart === undefined ? null : { start: row.codeStart, end: row.codeEnd,
      language: rows[row.codeStart].language, header: i === row.codeStart };
  }
  function chooseLanguage(language, advance = false) {
    refreshCodeSelection(); if (!codeSelection) return;
    const start = codeSelection.start, line = model.doc.line(start + 1), header = rows[start];
    const from = line.from + header.languageFrom, to = from + (header.language || '').length, delta = language.length - (to - from);
    const before = model.doc; model.beginGroup();
    if (language !== header.language) model.replace(from, to, language, { anchor: model.anchor > to ? model.anchor + delta : from + language.length,
      head: model.head > to ? model.head + delta : from + language.length });
    if (advance) {
      const next = rows[start + 1];
      if (next && next.codeStart === start && !next.codeFooter) {
        const target = model.doc.line(start + 2).from + (next.sourceOffset || 0); model.select(target);
      } else {
        const current = model.doc.line(start + 1), prefix = current.text.slice(0, header.sourceOffset || 0);
        const cr = current.text.endsWith('\r'), eol = cr ? '\r\n' : '\n';
        model.replace(current.to - (cr ? 1 : 0), current.to - (cr ? 1 : 0), eol + prefix);
      }
    }
    model.endGroup();
    if (model.doc !== before) changed(); else { syncInput(); revealCaret(); schedule(); }
  }
  function tokensForCode(i) {
    const row = rows[i]; if (row.type !== 'code' || !row.language) return null;
    const start = row.codeStart; let entry = codeCache.get(start);
    if (entry?.revision === model.revision && entry.language === row.language) return entry.lines?.[i - start - 1] || null;
    if (entry) clearTimeout(entry.timer);
    entry = { revision: model.revision, language: row.language }; codeCache.set(start, entry);
    if (codeCache.size > 8) { const [key, old] = codeCache.entries().next().value; clearTimeout(old.timer); codeCache.delete(key); }
    entry.timer = setTimeout(async () => {
      if (disposed || entry.revision !== model.revision) return;
      const end = rows[start].codeEnd, last = rows[end]?.codeFooter ? end - 1 : end;
      const sourceLines = []; for (let n = start + 1; n <= last; n++) sourceLines.push(model.doc.line(n + 1).text.slice(rows[n].sourceOffset || 0).replace(/\r$/, ''));
      const tokens = await highlighter.highlight(sourceLines.join('\n'), entry.language);
      if (disposed || entry.revision !== model.revision || codeCache.get(start) !== entry) return;
      let offset = 0;
      entry.lines = sourceLines.map(text => {
        const result = tokens.filter(t => t.to > offset && t.from < offset + text.length).map(t => ({ ...t, from: Math.max(0, t.from - offset), to: Math.min(text.length, t.to - offset) }));
        offset += text.length + 1; return result;
      });
      layouts.clear(); schedule();
    }, 70);
    return null;
  }
  function rebuild() {
    structureRebuilds++;
    rows = classifyLines(model.doc, { customCallouts: calloutTheme.customEnabled }); layouts.clear();
    refreshTableSelection(false);
    openCallouts = effectiveOpenCallouts(activeLines());
    heights = new HeightIndex(rows.map((_, i) => estimate(i)));
    spacer.style.height = `${Math.max(height, heights.total + (containerStyle.paddingBottom || 48))}px`;
    previousRaw.clear();
  }
  function asset(type, source, display, color = drawColor) {
    const key = `${type}:${display}:${color}:${source}`;
    if (assets.has(key)) { const value = assets.get(key); assets.delete(key); assets.set(key, value); return value; }
    if (assets.size >= 48) {
      const [oldKey, old] = assets.entries().next().value;
      if (old.image) { assetBytes -= old.bytes; old.image.src = ''; }
      assets.delete(oldKey);
    }
    const entry = { status: 'pending' }, epoch = assetEpoch; assets.set(key, entry);
    (async () => {
      try {
        let url;
        if (type === 'math') {
          if (source.length > 20000) throw new Error('公式过长');
          const result = await formulaEngine.render(source, { size: fontSize, color, display });
          if (disposed || epoch !== assetEpoch) return;
          url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
          entry.width = result.width; entry.height = result.height;
          entry.ascent = result.ascent; entry.depth = result.depth;
        } else {
          url = resolveImage(source);
          if (!/^(https?:|data:image\/|blob:|file:|typora:)/i.test(url)) throw new Error('不支持的图片地址');
        }
        const image = new Image(); image.decoding = 'async';
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片解码失败')); image.src = url; });
        if (disposed || epoch !== assetEpoch) { image.src = ''; return; }
        if (type === 'icon') {
          const icon = document.createElement('canvas'); icon.width = icon.height = 24 * dpr;
          const context = icon.getContext('2d'); context.drawImage(image, 0, 0, icon.width, icon.height);
          context.globalCompositeOperation = 'source-in'; context.fillStyle = color; context.fillRect(0, 0, icon.width, icon.height);
          entry.image = icon; entry.width = entry.height = 24;
        } else { entry.image = image; entry.width ||= image.naturalWidth; entry.height ||= image.naturalHeight; }
        entry.bytes = type === 'icon' ? entry.image.width * entry.image.height * 4 : image.naturalWidth * image.naturalHeight * 4;
        assetBytes += entry.bytes;
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
        if (disposed || epoch !== assetEpoch) return;
        entry.status = 'error'; entry.error = String(error);
        errorMessage = `${type === 'math' ? '公式' : '图片'}渲染失败：${error.message}`;
        console.error('[Typora Canvas] asset rendering failed', error); schedule();
      }
    })();
    return entry;
  }
  function layoutKey(i, raw) {
    const line = model.doc.line(i + 1);
    const cursor = raw && (['table', 'heading', 'rule', 'code-fence'].includes(rows[i].type) || line.text.includes('$')) ? `:${model.head - line.from}:${model.anchor - line.from}` : '';
    return `${i}:${raw}:${rows[i].revision}${cursor}${i === tableToolbarStart ? ':tools' : ''}`;
  }
  function clearCalloutCache() {
    for (const entry of calloutCache.values()) if (entry.image) entry.image.width = entry.image.height = 0;
    calloutCache.clear(); calloutBytes = 0;
  }
  function calloutPreview(i, rawSet) {
    const group = rows[i]?.callouts?.[0];
    if (!nativeCallouts || !group || [...rawSet].some(line => line >= group.start && line <= group.end)) return null;
    let entry = calloutCache.get(group.id);
    const markdown = entry?.doc === model.doc ? entry.markdown : model.doc.sliceString(model.doc.line(group.start + 1).from, model.doc.line(group.end + 1).to);
    const folded = rows.calloutGroups.filter(g => g.start >= group.start && g.end <= group.end && collapsed(g) && !openCallouts.has(g.id)).map(g => g.start - group.start);
    const key = `${contentWidth}:${dpr}:${assetEpoch}:${folded.join(',')}:${markdown}`;
    if (entry?.key !== key) {
      // Keep visible entries stable. More than eight small Callouts in one
      // viewport must fall back, rather than continuously evict one another.
      const first = heights.find(Math.max(0, scroll.scrollTop - 300)), last = heights.find(scroll.scrollTop + height + 300);
      for (const [id, old] of calloutCache) if (id !== group.id && (old.group.end < first || old.group.start > last)) {
        if (old.image) { calloutBytes -= old.bytes; old.image.width = old.image.height = 0; }
        calloutCache.delete(id);
      }
      if (!entry && calloutCache.size >= 8) return null;
      if (entry?.image) { calloutBytes -= entry.bytes; entry.image.width = entry.image.height = 0; }
      entry = { key, status: 'pending', group, doc: model.doc, markdown }; calloutCache.delete(group.id); calloutCache.set(group.id, entry);
      const pending = entry;
      while (calloutCache.size > 8) {
        const [id, old] = calloutCache.entries().next().value;
        if (old.image) { calloutBytes -= old.bytes; old.image.width = old.image.height = 0; }
        calloutCache.delete(id);
      }
      nativeCallouts.render({ markdown, width: contentWidth, folded, pixelRatio: dpr,
        valid: () => !disposed && calloutCache.get(group.id) === pending }).then(result => {
        if (disposed || calloutCache.get(group.id) !== pending) { result.image.width = result.image.height = 0; return; }
        const bytes = result.image.width * result.image.height * 4;
        if (calloutBytes + bytes > 32 * 1024 * 1024) { result.image.width = result.image.height = 0; throw new Error('Callout cache budget exceeded'); }
        Object.assign(pending, result, { status: 'ready', bytes }); calloutBytes += bytes;
        layouts.clear();
        for (let j = group.start; j <= group.end && j < rows.length; j++) heights.update(j, Math.max(.01, pending.starts[j - group.start + 1] - pending.starts[j - group.start]));
        schedule();
      }).catch(error => {
        if (disposed || calloutCache.get(group.id) !== pending) return;
        pending.status = 'error'; pending.error = error.message;
        console.warn('[Typora Canvas] native Callout fallback:', error.message); schedule();
      });
    }
    entry.doc = model.doc;
    if (!entry.image) return null;
    // Refresh LRU order without changing the active entry's identity.
    calloutCache.delete(group.id); calloutCache.set(group.id, entry);
    return { entry, index: i - group.start };
  }
  function layout(i, rawSet = activeLines()) {
    const raw = rawSet.has(i), key = layoutKey(i, raw);
    if (hiddenCallout(rows[i])) { heights.update(i, .01); return { height: .01, lines: [], top: 0, lineHeight: 29 }; }
    const native = calloutPreview(i, rawSet);
    if (native) {
      const { entry, index } = native, documentTop = i === 0 ? containerStyle.paddingTop || 0 : 0;
      const sliceTop = entry.starts[index], sliceHeight = entry.starts[index + 1] - sliceTop;
      const value = { height: Math.max(.01, sliceHeight) + documentTop, lines: [], top: documentTop, lineHeight: fontSize * 1.7,
        nativeCallout: entry, sliceTop, sliceHeight, documentTop };
      heights.update(i, value.height); layouts.set(key, value); return value;
    }
    if (!raw && ['math-tail', 'table-separator', 'blank'].includes(rows[i].type)) {
      const h = .01 + (i === 0 ? containerStyle.paddingTop || 0 : 0);
      heights.update(i, h); return { height: h, lines: [], top: 0, lineHeight: 29 };
    }
    let value = layouts.get(key);
    if (value?.nativeCallout) value = null;
    if (!value) {
      const line = model.doc.line(i + 1);
      const codeTokens = tokensForCode(i);
      value = layoutSourceLine(ctx, line.text, codeTokens ? { ...rows[i], codeTokens } : rows[i], { width: contentWidth, raw, font,
        cursor: model.head - line.from, selection: { from: model.from - line.from, to: model.to - line.from }, calloutTheme,
        typography, codeStyle, size: fontSize,
        asset: (type, source, display, color) => asset(type, source, display, color || (rows[i].type === 'table' ? rows[i].header ? tableStyle.headerColor : tableStyle.color : drawColor)), measure: (f, text) => {
          const key = `${f}\0${text}`; let w = measurements.get(key);
          if (w === undefined) { ctx.font = f; w = measurements.set(key, ctx.measureText(text).width); }
          return w;
        } });
      if (i === tableToolbarStart && value.cells) {
        value.tableTopGap = TABLE_TOOLS_HEIGHT; value.height += TABLE_TOOLS_HEIGHT;
        value.lines.forEach(line => { line.top += TABLE_TOOLS_HEIGHT; });
      }
      if (i === 0 && containerStyle.paddingTop) {
        const gap = containerStyle.paddingTop; value.documentTop = gap; value.height += gap; value.top += gap;
        value.lines.forEach(line => { line.top += gap; });
        if (value.rule) value.rule.y += gap;
      }
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
    spacer.style.height = `${Math.max(height, heights.total + (containerStyle.paddingBottom || 48))}px`;
    const topPadding = tableSelection ? TABLE_TOOLS_HEIGHT + 8 : 12;
    if (caret.y < scroll.scrollTop + topPadding) scroll.scrollTop = Math.max(0, caret.y - topPadding);
    else if (caret.y + caret.height > scroll.scrollTop + height - 12) scroll.scrollTop = caret.y + caret.height - height + 12;
    input.style.left = `${Math.max(0, Math.min(width - 3, caret.x))}px`;
    input.style.top = `${Math.max(0, Math.min(height - 28, caret.y - scroll.scrollTop))}px`;
  }
  function changed(change = null) {
    errorMessage = '';
    if (!change || change.addedLines || change.first !== change.last || rows[change.first]?.calloutHeader ||
        ['math', 'math-tail', 'code-fence'].includes(rows[change.first]?.type) || /[\n$`~|>\[\]]/.test(change.inserted + change.deleted) ||
        /^\s*[| :\-]+$/.test(model.doc.line(change.first + 1).text)) rebuild();
    else {
      const i = change.first, old = rows[i];
      const next = classifyLines({ lines: 1, line: () => ({ text: model.doc.line(i + 1).text.slice(old.sourceOffset || 0) }) })[0];
      if (!['code', 'table'].includes(old.type) && (next.type !== old.type || next.level !== old.level)) rebuild();
      else {
        rows[i] = ['code', 'table'].includes(old.type) ? { ...old, revision: old.revision + 1 } : {
          ...next, sourceLine: old.sourceLine, sourceOffset: old.sourceOffset, callouts: old.callouts, revision: old.revision + 1,
          paragraphStart: old.paragraphStart, paragraphEnd: old.paragraphEnd, previousBlock: old.previousBlock };
        heights.update(i, estimate(i, true));
      }
    }
    refreshTableSelection();
    hits = []; searchEpoch++; search.cancel();
    onChange(model); syncInput(); revealCaret(); schedule();
  }
  function setSelection(anchor, head = anchor, reveal = true) {
    model.select(anchor, head); refreshTableSelection(); syncInput(); if (reveal) revealCaret(); schedule();
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
    const padding = (containerStyle.paddingLeft || 0) + (containerStyle.paddingRight || 0);
    contentWidth = Math.max(24, Math.min((containerStyle.maxWidth || 948) - padding, scroll.clientWidth - padding));
    left = Math.max(containerStyle.paddingLeft || 0, (scroll.clientWidth - contentWidth - padding) / 2 + (containerStyle.paddingLeft || 0));
    if (!heights || widthChanged) { rebuild(); scroll.scrollTop = heights.prefix(Math.min(oldLine, rows.length - 1)); }
    schedule();
  }
  function updateTheme(next) {
    if (disposed) return;
    const anchor = heights?.find(scroll.scrollTop) || 0;
    fontSize = Math.max(6, parseFloat(next.fontSize) || 17);
    font = next.fontFamily || editorFont; drawColor = next.color || '#243044'; background = next.background || '#fafbfd';
    calloutTheme = next.callouts || defaultCalloutTheme();
    typography = next.typography || {}; codeStyle = next.code || {};
    tableStyle = next.table || tableStyle; containerStyle = next.container || containerStyle;
    host.style.setProperty('--tc-color', drawColor); host.style.setProperty('--tc-bg', background);
    input.style.fontSize = `${fontSize}px`; input.style.fontFamily = font;
    assetEpoch++; formulaEngine.destroy('主题切换');
    nativeCallouts?.invalidate(); clearCalloutCache();
    for (const entry of assets.values()) if (entry.image) entry.image.src = '';
    assets.clear(); assetBytes = 0; measurements.clear(); layouts.clear();
    const padding = (containerStyle.paddingLeft || 0) + (containerStyle.paddingRight || 0);
    contentWidth = Math.max(24, Math.min((containerStyle.maxWidth || 948) - padding, scroll.clientWidth - padding));
    left = Math.max(containerStyle.paddingLeft || 0, (scroll.clientWidth - contentWidth - padding) / 2 + (containerStyle.paddingLeft || 0));
    rebuild(); scroll.scrollTop = heights.prefix(Math.min(anchor, rows.length - 1)); schedule();
  }
  function paint() {
    raf = 0; if (disposed || !heights) return;
    const started = performance.now(), rawSet = activeLines();
    refreshTableSelection();
    refreshCodeSelection();
    updateOpenCallouts(rawSet);
    const anchor = heights.find(scroll.scrollTop), within = scroll.scrollTop - heights.prefix(anchor);
    for (const i of new Set([...rawSet, ...previousRaw])) if (i < rows.length && rawSet.has(i) !== previousRaw.has(i)) heights.update(i, estimate(i, rawSet.has(i)));
    previousRaw = rawSet;
    const first = heights.find(Math.max(0, scroll.scrollTop - 300));
    let deferred = false;
    for (let i = first; i < rows.length && heights.prefix(i) < scroll.scrollTop + height + 300; i++) {
      layout(i, rawSet);
      if (performance.now() - started > 8) { deferred = true; break; }
    }
    spacer.style.height = `${Math.max(height, heights.total + (containerStyle.paddingBottom || 48))}px`;
    scroll.scrollTop = heights.prefix(anchor) + Math.min(within, Math.max(0, heights.values[anchor] - 1));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, scroll.clientWidth, height); ctx.clip(); drawn = 0; previewFormulas = 0; drawnTables = 0; drawnNativeCallouts = 0;
    for (let i = heights.find(scroll.scrollTop); i < rows.length; i++) {
      const y = heights.prefix(i) - scroll.scrollTop; if (y > height) break;
      if (hiddenCallout(rows[i])) continue;
      const value = layouts.get(layoutKey(i, rawSet.has(i))); if (!value) continue;
      drawn++;
      const line = model.doc.line(i + 1), row = rows[i];
      if (value.nativeCallout) {
        if (value.sliceHeight > 0 && value.nativeCallout.image.width) {
          const entry = value.nativeCallout;
          ctx.drawImage(entry.image, 0, value.sliceTop * entry.ratio, entry.image.width, value.sliceHeight * entry.ratio,
            left, y + value.documentTop, contentWidth, value.sliceHeight); drawnNativeCallouts++;
          if (line.from < model.to && line.to > model.from || hits.includes(i)) {
            ctx.fillStyle = hits.includes(i) ? '#e9b94933' : '#609bf133'; ctx.fillRect(left, y, contentWidth, value.height);
          }
        }
        continue;
      }
      if (row.type === 'code' || row.type === 'code-fence') {
        const inset = value.inset || 0, top = value.documentTop || 0;
        ctx.fillStyle = codeStyle.background || '#8997b318'; ctx.fillRect(left + inset - 8, y + top, contentWidth - inset + 16, value.height - top);
      }
      if (value.rule) { ctx.fillStyle = value.rule.color; ctx.fillRect(left + (value.inset || 0), y + value.rule.y, contentWidth - (value.inset || 0), Math.max(1, value.rule.width)); }
      if (row.type === 'quote' && !row.callouts.length) { ctx.fillStyle = '#7393bd'; ctx.fillRect(left - 10, y, 3, value.height); }
      let calloutX = 0;
      for (const group of row.callouts) {
        const spec = calloutSpec(calloutTheme, group.type), topGap = group.start === i ? value.calloutTopGap || 0 : 0;
        const bottomGap = group.end === i ? value.calloutBottomGap || 0 : 0;
        if (spec.background && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(spec.background)) {
          ctx.fillStyle = spec.background; ctx.fillRect(left + calloutX, y + topGap, contentWidth - calloutX, value.height - topGap - bottomGap);
        }
        ctx.fillStyle = spec.borderColor; ctx.fillRect(left + calloutX, y + topGap, spec.borderWidth, Math.max(0, value.height - topGap - bottomGap));
        calloutX += spec.paddingLeft + 2;
      }
      if (value.cells) {
        drawnTables++;
        const tableX = left + (value.inset || 0), tableWidth = value.cellWidth * row.columns;
        const tableY = y + (value.tableTopGap || 0) + (value.documentTop || 0), rowHeight = value.height - (value.tableTopGap || 0) - (value.documentTop || 0);
        ctx.fillStyle = tableStyle.background || 'transparent'; ctx.fillRect(tableX, tableY, tableWidth, rowHeight);
        ctx.fillStyle = (row.header ? tableStyle.headerBackground : row.tableRow % 2 ? tableStyle.oddBackground : tableStyle.evenBackground) || 'transparent';
        ctx.fillRect(tableX, tableY, tableWidth, rowHeight);
        const horizontal = row.header ? tableStyle.headerBorderWidth ?? tableStyle.horizontalBorderWidth : tableStyle.horizontalBorderWidth;
        if (horizontal) {
          ctx.strokeStyle = row.header ? tableStyle.headerBorderColor || tableStyle.borderColor : tableStyle.borderColor; ctx.lineWidth = horizontal;
          ctx.beginPath(); ctx.moveTo(tableX, tableY + rowHeight); ctx.lineTo(tableX + tableWidth, tableY + rowHeight); ctx.stroke();
        }
        if (tableStyle.verticalBorderWidth) for (let c = 0; c <= row.columns; c++) {
          ctx.strokeStyle = tableStyle.borderColor; ctx.lineWidth = tableStyle.verticalBorderWidth;
          ctx.beginPath(); ctx.moveTo(tableX + c * value.cellWidth, tableY); ctx.lineTo(tableX + c * value.cellWidth, tableY + rowHeight); ctx.stroke();
        }
      }
      if (hits.includes(i)) { ctx.fillStyle = '#e9b94933'; ctx.fillRect(left - 8, y, contentWidth + 16, value.height); }
      if (value.media?.image) {
        if (row.type === 'math') previewFormulas++;
        ctx.drawImage(value.media.image, left + (value.mediaX || 0), y + value.top, value.mediaWidth, value.mediaHeight);
      }
      for (const visual of value.lines) for (const p of visual.pieces) {
        if (line.from + p.to > model.from && line.from + p.from < model.to) {
          ctx.fillStyle = '#609bf166'; ctx.fillRect(left + p.x, y + visual.top, Math.max(2, p.width), visual.height);
        }
        if (p.media?.image) {
          previewFormulas++;
          ctx.drawImage(p.media.image, left + p.x, y + visual.top + visual.baseline - p.ascent, p.width, p.height);
        }
        else { ctx.font = p.font; ctx.fillStyle = p.color || (p.link ? '#4c80d1' : drawColor);
          ctx.fillText(p.text, left + p.x, y + visual.top + visual.baseline); }
      }
      if (value.calloutTitle) {
        const title = value.calloutTitle, spec = title.spec;
        if (spec.iconUrl) {
          const icon = asset('icon', spec.iconUrl, false, spec.color);
          if (icon.image) ctx.drawImage(icon.image, left + title.x, y + title.y + 3, spec.iconSize, spec.iconSize);
        } else if (spec.iconGlyph) {
          ctx.font = `${spec.iconSize}px ${spec.iconFont || font}`; ctx.fillStyle = spec.color;
          ctx.fillText(spec.iconGlyph, left + title.x, y + title.y + spec.iconSize);
        }
      }
      if (value.codeBadge && row.codeStart !== codeSelection?.start) {
        ctx.fillStyle = codeStyle.color || drawColor; ctx.font = `12px ${font}`;
        ctx.fillText(`${languageLabel(value.codeBadge.language)} ▾`, left + (value.inset || 0), y + (value.documentTop || 0) + value.codeBadge.y + 19);
      }
    }
    if (focused && model.from === model.to) {
      const caret = caretBox(); ctx.fillStyle = drawColor;
      ctx.fillRect(caret.x, caret.y - scroll.scrollTop, 1.5, caret.height);
      input.style.left = `${Math.max(0, Math.min(width - 3, caret.x))}px`;
      input.style.top = `${Math.max(0, Math.min(height - 28, caret.y - scroll.scrollTop))}px`;
    }
    ctx.restore(); lastPaintMs = performance.now() - started;
    if (tableSelection) {
      const header = layout(tableSelection.start, rawSet), inset = header.inset || 0;
      tableUI.update(tableSelection, { x: left + inset, y: Math.max(0, Math.min(height - 30, heights.prefix(tableSelection.start) - scroll.scrollTop + (header.documentTop || 0))),
        width: Math.max(40, Math.min(contentWidth - inset, scroll.clientWidth - left - inset - 4)) });
    }
    refreshCodeSelection();
    if (codeSelection) {
      const header = layout(codeSelection.start, rawSet), sourceLine = model.doc.line(codeSelection.start + 1), meta = rows[codeSelection.start];
      const cursor = model.head - sourceLine.from;
      const query = codeSelection.header && focused && cursor >= meta.languageFrom && cursor <= meta.languageFrom + meta.language.length
        ? sourceLine.text.slice(meta.languageFrom, cursor) : null;
      codeUI.update({ ...codeSelection, editingHeader: codeSelection.header && rawSet.has(codeSelection.start) && cursor > 0 },
        { x: left + (header.inset || 0), y: Math.max(0, heights.prefix(codeSelection.start) - scroll.scrollTop + (header.documentTop || 0) + (header.codeBadge?.y || 0)) }, query);
    } else codeUI.update(null);
    const line = model.doc.lineAt(model.head);
    status.textContent = errorMessage || `Canvas 编辑${model.dirty ? ' · 未保存' : ''} · ${line.number}:${model.head - line.from + 1} · 绘制 ${drawn}/${rows.length} 行 · ${lastPaintMs.toFixed(1)}ms`;
    if (deferred) schedule();
  }
  function hit(x, y) {
    const i = heights.find(Math.max(0, y));
    const value = layout(i), line = model.doc.line(i + 1);
    if (value.nativeCallout) {
      const contentStart = rows[i].calloutHeader?.titleFrom ?? rows[i].sourceOffset ?? 0;
      return line.from + Math.min(line.text.length, contentStart + Math.max(0, Math.round((x - left - 16) / (fontSize * .8))));
    }
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
    const r = main.getBoundingClientRect(), y = event.clientY - r.top;
    if (!dragging && calloutTheme.hoverPreview) {
      const i = heights.find(y + scroll.scrollTop), row = rows[i];
      const x = event.clientX - r.left;
      const next = new Set(x >= left && x <= left + contentWidth ? (row?.callouts || []).filter(collapsed).map(g => g.id) : []);
      if (next.size !== hoverCallouts.size || [...next].some(id => !hoverCallouts.has(id))) { hoverCallouts = next; schedule(); }
    }
    if (!dragging) return;
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
    if (codeUI.key(event)) return;
    if (codeUI.owns(event.composedPath()[0])) return;
    if (tableUI.owns(event.composedPath()[0])) {
      if (key === 'escape') { event.preventDefault(); tableUI.close(); input.focus({ preventScroll: true }); }
      return;
    }
    if (key === 'escape') {
      event.preventDefault();
      if (tableUI.open) tableUI.close(); else if (findPanel.classList.contains('open')) closeFind(); else onClose(); return;
    }
    if (mod && key === 'a') { event.preventDefault(); setSelection(0, model.length); return; }
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault(); if ((key === 'y' || event.shiftKey) ? model.redo() : model.undo()) changed(); return;
    }
    if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      refreshTableSelection();
      if (tableSelection) { event.preventDefault(); runTableAction(({ ArrowUp: 'move-row-up', ArrowDown: 'move-row-down', ArrowLeft: 'move-column-left', ArrowRight: 'move-column-right' })[event.key]); return; }
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
    if (event.key === 'Tab') {
      event.preventDefault(); if (!navigateTable(event.shiftKey ? -1 : 1)) changed(model.replaceSelection('  ')); return;
    }
    if (event.key === 'Enter') {
      refreshTableSelection();
      if (tableSelection) {
        event.preventDefault();
        if (mod && event.shiftKey) exitTable(); else if (mod) runTableAction('insert-row-below');
        else if (event.shiftKey) changed(model.replaceSelection('<br>')); else navigateTable(1, true);
        return;
      }
    }
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
    searchCallouts = new Set(rows[i].callouts.map(group => group.id)); updateOpenCallouts(activeLines());
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
    [scroll, 'pointerleave', () => { if (hoverCallouts.size) { hoverCallouts.clear(); schedule(); } }, false],
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
  const stopThemeWatch = getTheme ? watchCanvasTheme(getTheme, updateTheme, { nodes: themeNodes }) : () => {};
  return { host, model, getText: () => model.getText(), save,
    setStatus: message => { errorMessage = message; schedule(); }, updateTheme,
    scrollToLine: i => { scroll.scrollTop = heights.prefix(Math.max(0, Math.min(rows.length - 1, i))); schedule(); },
    getLineRect: i => ({ x: left, y: heights.prefix(i) - scroll.scrollTop, width: contentWidth, height: heights.values[i] }),
    getStats: () => ({ mode: 'canvas-editor', lines: rows.length, drawnLines: drawn, cachedLayouts: layouts.size,
      domNodes: root.querySelectorAll('*').length, canvasWidth: canvas.width, canvasHeight: canvas.height,
      paintMs: lastPaintMs, dirty: model.dirty, assets: assets.size, readyAssets: [...assets.values()].filter(a => a.image).length,
      assetBytes, previewFormulas, drawnTables, calloutGroups: rows.calloutGroups.length,
      hiddenCalloutLines: rows.filter(hiddenCallout).length,
      nativeCallouts: { cached: calloutCache.size, ready: [...calloutCache.values()].filter(e => e.image).length,
        drawnSlices: drawnNativeCallouts, bytes: calloutBytes, errors: [...calloutCache.values()].filter(e => e.status === 'error').map(e => e.error) },
      theme: { color: drawColor, background, font, fontSize },
      tableTheme: tableStyle, typography, codeTheme: codeStyle,
      codeBlocks: rows.codeBlocks.length, highlightedCodeLines: [...codeCache.values()].reduce((n, entry) => n + (entry.lines?.filter(tokens => tokens.length).length || 0), 0),
      table: tableSelection ? { row: tableSelection.row, column: tableSelection.column, rows: tableSelection.rowCount, columns: tableSelection.columns } : null,
      failedAssets: [...assets.values()].filter(a => a.status === 'error').length,
      structureRebuilds, selection: model.selection,
      scopedInputLength: input.value.length }), destroy() {
      if (disposed) return; disposed = true; cancelAnimationFrame(raf); clearTimeout(searchTimer); search.cancel(); resizeObserver.disconnect(); stopThemeWatch();
      events.forEach(([el, name, fn, options]) => el.removeEventListener(name, fn, options)); tableUI.destroy(); codeUI.destroy(); highlighter.destroy();
      for (const entry of codeCache.values()) clearTimeout(entry.timer); codeCache.clear();
      formulaEngine.destroy();
      nativeCallouts?.destroy(); clearCalloutCache();
      for (const entry of assets.values()) if (entry.image) entry.image.src = '';
      assets.clear(); layouts.clear(); measurements.clear(); host.remove();
    } };
}
