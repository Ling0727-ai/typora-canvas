import defaults from './callout-defaults.json' with { type: 'json' };

export function defaultCalloutTheme(dark = false) {
  return { customEnabled: true, hoverPreview: true, types: Object.fromEntries(Object.entries(defaults.types).map(([type, spec]) => [type, {
    ...spec, color: dark ? spec.darkColor || spec.color : spec.color,
    borderColor: dark ? spec.darkBorderColor || spec.borderColor : spec.borderColor,
    background: 'transparent', borderWidth: 2, paddingLeft: 14, marginTop: 18, marginBottom: 18, iconSize: 17
  }])) };
}

export function calloutSpec(theme, type) {
  return theme.types[type] || theme.types.note || defaultCalloutTheme().types.note;
}

export function readCalloutTheme({ write, config = {} }) {
  const theme = defaultCalloutTheme();
  theme.customEnabled = config.ENABLE !== false;
  theme.hoverPreview = config.HOVER_TO_SHOW_FOLD_CALLOUT !== false;
  if (!write?.ownerDocument) return theme;
  const doc = write.ownerDocument, probe = doc.createElement('blockquote');
  probe.className = 'plugin-callout';
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'absolute', pointerEvents: 'none', visibility: 'hidden' });
  const p = doc.createElement('p'), span = doc.createElement('span');
  span.textContent = '[!note] Title'; span.setAttribute('data-type', 'Title'); p.append(span); probe.append(p);
  const configured = new Map((config.CALLOUTS || []).map(spec => [spec.type.toLowerCase(), spec]));
  const types = new Set([...Object.keys(theme.types), ...configured.keys()]);
  // Only sample computed style. No note text is rewritten, no host pixels are
  // captured, and the editor continues to paint these shapes itself.
  write.append(probe);
  try {
    for (const type of types) {
      if (!/^\w+$/.test(type)) continue;
      probe.setAttribute('callout-type', type);
      const block = getComputedStyle(probe), title = getComputedStyle(span, '::after'), before = getComputedStyle(p, '::before');
      const inherited = getComputedStyle(span);
      const fallback = theme.types[type] || theme.types.note;
      const custom = configured.get(type);
      const rgb = block.getPropertyValue('--obs-callout-rgb').trim();
      const resolvedMask = before.getPropertyValue('mask-image') || before.getPropertyValue('-webkit-mask-image');
      const icon = resolvedMask && resolvedMask !== 'none' ? resolvedMask : block.getPropertyValue('--obs-callout-icon').trim();
      const iconUrl = /^url\(["']?(.*?)["']?\)$/.exec(icon)?.[1];
      theme.types[type] = {
        ...fallback, color: rgb ? title.color || inherited.color || `rgb(${rgb})` : custom?.left_line_color || fallback.color,
        borderColor: parseFloat(block.borderLeftWidth) ? block.borderLeftColor : custom?.left_line_color || fallback.borderColor,
        borderWidth: parseFloat(block.borderLeftWidth) || fallback.borderWidth,
        background: block.backgroundColor || custom?.background_color || fallback.background,
        paddingLeft: parseFloat(block.paddingLeft) || fallback.paddingLeft,
        marginTop: parseFloat(block.marginTop) || fallback.marginTop, marginBottom: parseFloat(block.marginBottom) || fallback.marginBottom,
        titleSize: parseFloat(title.fontSize) || parseFloat(inherited.fontSize) || undefined,
        iconSize: parseFloat(before.width) || 17, iconFont: before.fontFamily || config.FONT_FAMILY,
        iconGlyph: custom?.icon || '', iconUrl: iconUrl || (theme.types[type] ? fallback.iconUrl : '')
      };
    }
  } finally { probe.remove(); }
  return theme;
}

function quotePrefix(text) {
  let offset = 0; const offsets = [];
  while (true) {
    const match = /^[\t ]*>[\t ]?/.exec(text.slice(offset));
    if (!match) break;
    offset += match[0].length; offsets.push(offset);
  }
  return { depth: offsets.length, offset, offsets };
}

export function calloutContexts(doc, { customEnabled = true } = {}) {
  const contexts = [], groups = [], stack = [];
  let fence = null;
  for (let i = 0; i < doc.lines; i++) {
    const original = doc.line(i + 1).text, prefix = quotePrefix(original);
    if (fence && prefix.depth < fence.depth) fence = null;
    while (stack.length && stack.at(-1).depth > prefix.depth) stack.pop().end = i - 1;
    const text = original.slice(prefix.offset);
    const marker = /^\s*(`{3,}|~{3,})/.exec(text);
    const candidate = !fence && prefix.depth ? /^\[!(\w+)\]([+-]?)[\t ]*(.*)/.exec(text) : null;
    const match = candidate && (customEnabled || ['note', 'tip', 'important', 'warning', 'caution'].includes(candidate[1].toLowerCase())) ? candidate : null;
    if (match) {
      while (stack.length && stack.at(-1).depth >= prefix.depth) stack.pop().end = i - 1;
      const title = match[3].trim();
      const group = { id: `${i}:${prefix.depth}:${match[1].toLowerCase()}`, start: i, end: i, depth: prefix.depth,
        type: match[1].toLowerCase(), title: title || match[1], fold: match[2],
        titleFrom: title ? prefix.offset + match[0].length - match[3].length + match[3].indexOf(title) : prefix.offset + 2 };
      stack.push(group); groups.push(group);
    }
    const sourceOffset = stack.length ? prefix.offsets[stack.at(-1).depth - 1] : 0;
    const path = [...stack]; path.forEach(group => { group.end = i; });
    contexts.push({ sourceLine: i, sourceOffset, content: original.slice(sourceOffset), callouts: path,
      calloutHeader: match ? stack.at(-1) : null });
    if (fence) { if (marker && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length) fence = null; }
    else if (marker) fence = { marker: marker[1], depth: prefix.depth };
  }
  return { contexts, groups };
}
