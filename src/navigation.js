import MarkdownIt from 'markdown-it';
const markdown = new MarkdownIt({ html: false });
const plain = source => {
  const tokens = markdown.parseInline(source, {})[0]?.children || [];
  return tokens.map(t => t.type === 'text' || t.type === 'code_inline' ? t.content : t.type === 'image' ? t.content : '').join('');
};
export function headingIndex(doc, rows) {
  const used = new Set();
  return rows.flatMap((row, line) => {
    if (row.type !== 'heading') return [];
    const source = doc.line(line + 1).text.slice(row.sourceOffset || 0).replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
    const title = plain(source);
    const slug = title.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    let id = slug, suffix = 0;
    while (used.has(id)) id = `${slug}-${++suffix}`;
    used.add(id);
    return [{ line, level: row.level, source, title, id, ref: `tc-heading-${line}` }];
  });
}
export function anchorHeading(headings, fragment) {
  let id;
  try { id = decodeURIComponent(fragment.replace(/^#/, '')); } catch { return null; }
  return headings.find(h => h.id === id || h.id === id.toLowerCase()) || headings.find(h => h.title === id) || null;
}

// Retain source ranges even when the active line displays Markdown markers.
// Balanced parentheses allow local filenames and normal URL paths with ().
export function sourceLinks(text) {
  const links = [], code = /(`+)[\s\S]*?\1/g, excluded = [...text.matchAll(code)].map(m => [m.index, m.index + m[0].length]);
  const pattern = /(?<!!)\[([^\]\n]+)\]\(|<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (text[match.index - 1] === '\\' || excluded.some(([a, b]) => match.index >= a && match.index < b)) continue;
    if (match[2]) { links.push({ from: match.index, to: pattern.lastIndex, href: match[2] }); continue; }
    let end = pattern.lastIndex, depth = 1, quoted = false, angle = false;
    for (; end < text.length; end++) {
      const c = text[end]; if (c === '\\') { end++; continue; }
      if (c === '\n') break;
      if (c === '"' && !angle) quoted = !quoted;
      if (quoted) continue;
      if (c === '<') angle = true; if (c === '>') angle = false;
      if (!angle && c === '(') depth++; if (!angle && c === ')' && --depth === 0) break;
    }
    if (depth) continue;
    const destination = text.slice(pattern.lastIndex, end).trim();
    const href = destination.startsWith('<') ? /^<([^>]+)>/.exec(destination)?.[1] : /^(.*?)(?:\s+"[^"]*")?$/.exec(destination)?.[1];
    if (href) links.push({ from: match.index, to: end + 1, href: href.replace(/\\([()])/g, '$1') });
    pattern.lastIndex = end + 1;
  }
  return links;
}

export function safeLink(href) {
  return !/^[\u0000-\u0020]*(?:javascript|vbscript|data|blob):/i.test(href) && !/[\u0000-\u001f]/.test(href);
}

// Use the native outline's renderer and event surface, while giving it only
// small heading descriptors. The hidden full-document DOM stays untouched.
export function attachCanvasNavigation({ editor, outline, document: doc = document, openLink = () => {} }) {
  let headings = [], signature = '', timer, detached = false;
  const originals = new Map(), patches = new Map();
  const patch = (key, fn) => {
    if (!outline || typeof outline[key] !== 'function') return;
    originals.set(key, outline[key]); patches.set(key, fn); outline[key] = fn;
  };
  const toc = () => ({ headers: headings.map(h => ({ cid: h.ref, isDeleted: () => false,
    get: key => key === 'depth' ? h.level : key === 'text' ? h.source : undefined })) });
  const highlight = () => {
    const line = editor.getFirstVisibleLine();
    const active = headings.findLast(h => h.line <= line || editor.getLineRect(h.line).y <= 24) || headings[0];
    for (const label of doc.querySelectorAll('.outline-label')) {
      const selected = label.dataset.ref === active?.ref;
      label.classList.toggle('outline-active', selected); label.parentElement?.classList.toggle('outline-item-active', selected);
    }
  };
  const update = () => {
    if (detached) return;
    headings = editor.getOutline();
    const next = JSON.stringify(headings);
    if (signature !== next) { signature = next; outline?.updateOutlineHtml?.(toc(), true); }
    highlight();
  };
  patch('updateOutlineHtml', (_toc, force) => {
    const result = originals.get('updateOutlineHtml').call(outline, toc(), force);
    highlight(); return result;
  });
  patch('getHeaderMatrix', text => headings.map(h => [h.level, text ? h.title : markdown.renderInline(h.source), h.ref]));
  patch('highlightVisibleHeader', highlight);
  patch('renderOutline', () => {
    outline.updateOutlineHtml(toc(), true);
    const panel = doc.querySelector('#outline-content');
    if (panel) for (const other of doc.querySelectorAll('.outline-content')) if (other !== panel) other.innerHTML = panel.innerHTML;
    highlight();
  });
  patch('onEnterKey', event => {
    const selected = doc.querySelector('.outline-item.select .outline-label');
    const target = headings.find(h => h.ref === selected?.dataset.ref);
    if (!target) return originals.get('onEnterKey').call(outline, event);
    editor.scrollToLine(target.line); highlight(); event.preventDefault?.();
  });
  const click = event => {
    const item = event.target.closest?.('.outline-item');
    if (!item || event.target.closest('.outline-expander') || event.button > 0) return;
    const ref = item.querySelector('.outline-label')?.dataset.ref;
    const heading = headings.find(h => h.ref === ref);
    if (!heading) return;
    event.preventDefault(); event.stopImmediatePropagation();
    item.parentElement.classList.add('outline-item-open');
    editor.scrollToLine(heading.line); outline?.autoHideOutline?.(); highlight();
  };
  doc.addEventListener('click', click, true);
  update();
  return { refresh() { clearTimeout(timer); timer = setTimeout(update, 120); }, highlight,
    open(href) {
      if (!safeLink(href)) { editor.setStatus('不支持此链接地址'); return; }
      if (href.startsWith('#')) {
        update(); const target = anchorHeading(headings, href);
        if (target) editor.scrollToLine(target.line); else editor.setStatus(`未找到标题：${href}`);
      } else return openLink(href);
    },
    detach() {
      detached = true; clearTimeout(timer); doc.removeEventListener('click', click, true);
      for (const [key, value] of originals) if (outline[key] === patches.get(key)) outline[key] = value;
      outline?.renderOutline?.();
    }
  };
}
