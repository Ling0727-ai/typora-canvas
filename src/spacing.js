export function markBlankSpacing(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.type !== 'blank') continue;
    const scope = row.callouts.at(-1)?.id, start = i;
    while (i + 1 < rows.length && rows[i + 1].type === 'blank' && rows[i + 1].callouts.at(-1)?.id === scope) i++;
    const adjacentHeading = [rows[start - 1], rows[i + 1]].some(r => r?.type === 'heading' && r.callouts.at(-1)?.id === scope);
    // Body separators remain visible. Within a Callout only its trailing run
    // collapses; internal blank paragraphs still divide topics.
    const group = row.callouts.at(-1);
    for (let j = start; j <= i; j++) rows[j].emptyParagraph = group ? i < group.end : !adjacentHeading;
  }
}

// Markdown parsers discard empty paragraphs. Restore only visible source blanks
// inside their original block container, keeping line maps for capture slices.
export function insertBlankParagraphs(tokens, rows, makeToken) {
  const containers = [], stack = [], additions = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.nesting === 1) stack.push({ token, start: i });
    if (token.nesting === -1) {
      const opened = stack.pop();
      if (opened && ['blockquote_open', 'list_item_open'].includes(opened.token.type)) containers.push({ ...opened, end: i });
    }
  }
  for (let line = 0; line < rows.length; line++) {
    if (!rows[line].emptyParagraph) continue;
    const parent = containers.filter(c => c.token.map?.[0] <= line && line < c.token.map[1])
      .sort((a, b) => b.start - a.start)[0];
    const end = parent?.end ?? tokens.length;
    let index = end;
    for (let i = (parent?.start ?? -1) + 1; i < end; i++) {
      if (tokens[i].map?.[0] > line) { index = i; break; }
    }
    const token = makeToken(); token.map = [line, line + 1];
    if (!additions.has(index)) additions.set(index, []);
    additions.get(index).push(token);
  }
  return tokens.flatMap((token, i) => [...(additions.get(i) || []), token]).concat(additions.get(tokens.length) || []);
}

export function blankGeometry(row, typography = {}, size = 17) {
  const style = typography.blank || typography.paragraph || {};
  const lineHeight = style.lineHeight || Math.ceil((style.fontSize || size) * 1.7);
  if (!row.emptyParagraph) return { height: .01, lines: [], top: 0, lineHeight, fontSize: style.fontSize || size };
  const previous = row.previousBlock?.type === 'blank' ? typography.blank || typography.paragraph
    : row.previousBlock?.type === 'heading' ? typography.headings?.[row.previousBlock.level - 1] : typography.paragraph;
  const top = (style.paddingTop || 0) + Math.max(0, (style.marginTop || 0) - (previous?.marginBottom || 0));
  const contentHeight = Math.max(lineHeight, style.minHeight || 0);
  const bottom = (style.paddingBottom || 0) + (style.marginBottom || 0);
  // An empty visual row retains its source position for clicks and caret moves.
  return { height: top + contentHeight + bottom, lines: [{ pieces: [], top, height: contentHeight, baseline: contentHeight * .8 }],
    top, lineHeight, fontSize: style.fontSize || size };
}
