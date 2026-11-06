export const transparent = color => !color || color === 'transparent' || /^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\s*\)$/.test(color);
const px = (value, fallback = 0) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;
const firstColor = (nodes, property = 'backgroundColor', fallback = 'transparent') => {
  for (const node of nodes) {
    const value = getComputedStyle(node)[property]; if (!transparent(value)) return value;
  }
  return fallback;
};
function textStyle(node) {
  const s = getComputedStyle(node), fontSize = px(s.fontSize, 17);
  return { color: s.color, fontFamily: s.fontFamily, fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle,
    lineHeight: px(s.lineHeight, fontSize * 1.7), marginTop: px(s.marginTop), marginBottom: px(s.marginBottom),
    paddingTop: px(s.paddingTop), paddingBottom: px(s.paddingBottom), paddingLeft: px(s.paddingLeft), paddingRight: px(s.paddingRight) };
}
function inlineStyles(node) {
  const doc = node.ownerDocument, inline = {}, ordinary = textStyle(node);
  for (const [key, html] of Object.entries({ strong: '<strong>Text</strong>', em: '<em>Text</em>',
    strongEm: '<strong><em>Text</em></strong>', code: '<code>Text</code>', link: '<a href="#">Text</a>' })) {
    const wrapper = doc.createElement('span'); wrapper.innerHTML = html; node.append(wrapper);
    const leaf = wrapper.querySelector(key === 'strongEm' ? 'em' : '*'), sampled = textStyle(leaf), changes = {};
    // Record overrides within the actual block context, rather than copying
    // paragraph inheritance onto a differently styled heading or table cell.
    for (const property of ['color', 'fontFamily', 'fontWeight', 'fontStyle'])
      if (sampled[property] !== ordinary[property]) changes[property] = sampled[property];
    if (sampled.fontSize !== ordinary.fontSize) changes.fontSizeScale = sampled.fontSize / ordinary.fontSize;
    inline[key] = changes; wrapper.remove();
  }
  return inline;
}

// Short-lived, empty semantic probes sample CSS selectors (including tr:nth-child
// and CodeMirror token classes). They never replace or rasterize the document.
export function readNativeStyles(write) {
  const doc = write.ownerDocument, nodes = [];
  const append = tag => {
    const node = doc.createElement(tag);
    node.style.cssText = 'position:absolute!important;visibility:hidden!important;pointer-events:none!important;transition:none!important;animation:none!important';
    write.append(node); nodes.push(node); return node;
  };
  try {
    const paragraph = append('p'); paragraph.textContent = 'Text';
    const inline = inlineStyles(paragraph);
    const headings = Array.from({ length: 6 }, (_, i) => {
      const h = append(`h${i + 1}`); h.textContent = 'Heading'; return { ...textStyle(h), inline: inlineStyles(h) };
    });
    const hr = append('hr'), rule = getComputedStyle(hr);
    const table = append('table');
    table.innerHTML = '<thead><tr><th>Header</th></tr></thead><tbody><tr><td>Odd</td></tr><tr><td>Even</td></tr></tbody>';
    const th = table.querySelector('th'), [odd, even] = table.querySelectorAll('td');
    const cell = getComputedStyle(odd), header = getComputedStyle(th);
    const code = append('pre'); code.className = 'md-fences';
    code.innerHTML = '<div class="CodeMirror cm-s-inner"><div class="CodeMirror-code"><pre class="CodeMirror-line"><span></span></pre></div></div>';
    const codeLine = code.querySelector('pre'), codeStyle = textStyle(codeLine), cm = code.querySelector('.CodeMirror');
    const tokenHost = codeLine.querySelector('span'), tokenColors = {};
    const tokenTypes = { keyword: 'keyword', built_in: 'builtin', type: 'type', literal: 'atom', number: 'number', string: 'string',
      comment: 'comment', meta: 'meta', title: 'def', params: 'variable', attr: 'attribute', tag: 'tag', property: 'property', operator: 'operator' };
    for (const [token, cmClass] of Object.entries(tokenTypes)) {
      const span = doc.createElement('span'); span.className = `cm-${cmClass}`; span.textContent = 'x'; tokenHost.append(span);
      tokenColors[token] = getComputedStyle(span).color; span.remove();
    }
    const root = getComputedStyle(write);
    return { container: { maxWidth: px(root.maxWidth, 948), paddingTop: px(root.paddingTop), paddingBottom: px(root.paddingBottom, 48),
      paddingLeft: px(root.paddingLeft, 24), paddingRight: px(root.paddingRight, 24) },
      typography: { paragraph: { ...textStyle(paragraph), inline }, headings, inline,
        tableHeader: { ...textStyle(th), inline: inlineStyles(th) }, tableCell: { ...textStyle(odd), inline: inlineStyles(odd) },
        rule: { color: px(rule.borderTopWidth) ? rule.borderTopColor : rule.color,
          width: px(rule.borderTopWidth, 1), marginTop: px(rule.marginTop, 16), marginBottom: px(rule.marginBottom, 16) } },
      table: { background: getComputedStyle(table).backgroundColor,
        headerBackground: firstColor([th, th.parentElement, table.querySelector('thead'), table]),
        oddBackground: firstColor([odd, odd.parentElement, table.querySelector('tbody'), table]),
        evenBackground: firstColor([even, even.parentElement, table.querySelector('tbody'), table]),
        headerColor: header.color, color: cell.color,
        borderColor: px(cell.borderBottomWidth) ? cell.borderBottomColor : cell.borderLeftColor,
        horizontalBorderWidth: px(cell.borderBottomWidth), verticalBorderWidth: px(cell.borderLeftWidth),
        headerBorderColor: px(header.borderBottomWidth) ? header.borderBottomColor : cell.borderBottomColor,
        headerBorderWidth: px(header.borderBottomWidth) },
      code: { ...codeStyle, marginTop: parseFloat(getComputedStyle(code).marginTop) || 0, marginBottom: parseFloat(getComputedStyle(code).marginBottom) || 0,
        fontFamily: getComputedStyle(cm).fontFamily || codeStyle.fontFamily,
        background: firstColor([codeLine, cm, code]), tokenColors } };
  } finally { nodes.forEach(node => node.remove()); }
}
