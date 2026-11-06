const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
import { tableCells } from './editor-model.js';
import { defaultCalloutTheme, calloutSpec } from './callouts.js';
export const editorFont = '"Segoe UI", "Microsoft YaHei", sans-serif';

// Inactive lines elide common Markdown markers; the active source line is exact.
// Every visible fragment retains its UTF-16 source range for pointer hit testing.
export function sourceRuns(text, row, raw, cursor = -1, selection = null) {
  if (row.type === 'math' || row.type === 'math-tail') return [{ text, from: 0, to: text.length }];
  if (row.type === 'code' || row.type === 'code-fence') {
    if (!row.codeTokens?.length || row.type === 'code-fence') return [{ text, from: 0, to: text.length, code: true }];
    const runs = []; let from = 0;
    for (const token of row.codeTokens) {
      const start = Math.max(from, token.from), end = Math.min(text.length, token.to);
      if (start > from) runs.push({ text: text.slice(from, start), from, to: start, code: true });
      if (end > start) runs.push({ text: text.slice(start, end), from: start, to: end, token: token.type, code: true });
      from = Math.max(from, end);
    }
    if (from < text.length) runs.push({ text: text.slice(from), from, to: text.length, code: true });
    return runs;
  }
  if (raw) {
    const runs = []; let from = 0;
    const math = /(?<!\\)\$(?!\$)([^$\n]+)\$/g; let match;
    while ((match = math.exec(text))) {
      const end = math.lastIndex;
      if (match.index > from) runs.push({ text: text.slice(from, match.index), from, to: match.index });
      const selected = selection && selection.from < end && selection.to > match.index && selection.from !== selection.to;
      const expanded = cursor > match.index && cursor < end || selected;
      runs.push(expanded ? { text: match[0], from: match.index, to: end }
        : { text: match[1], tex: match[1], from: match.index, to: end });
      from = end;
    }
    if (from < text.length) runs.push({ text: text.slice(from), from, to: text.length });
    return runs;
  }
  let start = 0;
  const prefix = /^(#{1,6}\s+|\s*>\s?)/.exec(text);
  if (prefix) start = prefix[0].length;
  const runs = [];
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|\$([^$\n]+)\$|(<[bB][rR]\s*\/?>)/g;
  let consumed = start, match;
  pattern.lastIndex = start;
  while ((match = pattern.exec(text))) {
    if (match.index > consumed) runs.push({ text: text.slice(consumed, match.index), from: consumed, to: match.index });
    if (match[8]) {
      runs.push({ text: '', break: true, from: match.index, to: pattern.lastIndex });
      consumed = pattern.lastIndex; continue;
    }
    const value = match[1] || match[2] || match[3] || match[4] || match[5] || match[7];
    const offset = match[0].indexOf(value);
    runs.push({ text: value, from: match[7] ? match.index : match.index + offset,
      to: match[7] ? pattern.lastIndex : match.index + offset + value.length,
      bold: !!(match[1] || match[2]), code: !!match[3], italic: !!match[4], link: match[6], tex: match[7] });
    consumed = pattern.lastIndex;
  }
  if (consumed < text.length) runs.push({ text: text.slice(consumed), from: consumed, to: text.length });
  return runs;
}

export function layoutSourceLine(ctx, text, row, { width, raw, font = editorFont, size = 17, asset, measure, cursor = -1,
  selection = null, calloutTheme = defaultCalloutTheme(), typography = {}, codeStyle = {} }) {
  if (row.callouts?.length) {
    const group = row.callouts.at(-1), spec = calloutSpec(calloutTheme, group.type), header = row.calloutHeader;
    const editingHeader = !!header && raw && (cursor > 0 && cursor < text.length || selection?.from !== selection?.to);
    const sourceOffset = header ? editingHeader ? 0 : group.titleFrom : row.sourceOffset;
    const label = header && !editingHeader ? group.title : text.slice(sourceOffset);
    const indent = row.callouts.reduce((sum, g) => sum + calloutSpec(calloutTheme, g.type).paddingLeft + 2, 0);
    const iconWidth = header && !editingHeader ? spec.iconSize + 8 : 0;
    const topGap = header ? Math.min(32, spec.marginTop) : 0;
    const bottomGap = row.callouts.some(g => g.end === row.sourceLine) ? 8 : 0;
    const value = layoutSourceLine(ctx, label, { ...row, type: header ? 'paragraph' : row.type,
      header: !!header, callouts: [], sourceOffset: 0, calloutWrapped: true }, {
      width: Math.max(24, width - indent - iconWidth), raw: header && !editingHeader ? false : raw,
      font, size: header && spec.titleSize ? spec.titleSize : size, measure,
      typography: header ? { ...typography, paragraph: { ...typography.paragraph, fontSize: spec.titleSize || size,
        fontWeight: '600', color: spec.color, marginTop: 0, marginBottom: 0 } } : typography, codeStyle,
      cursor: cursor - sourceOffset,
      selection: selection ? { from: selection.from - sourceOffset, to: selection.to - sourceOffset } : null,
      asset: (type, source, display) => asset(type, source, display, header ? spec.color : undefined) });
    const offsetX = indent + iconWidth;
    for (const line of value.lines) {
      line.top += topGap;
      for (const p of line.pieces) {
        p.x += offsetX; p.from += sourceOffset; p.to += sourceOffset;
        if (header) p.color = spec.color;
      }
    }
    if (value.cells) for (const cell of value.cells) { cell.x += offsetX; cell.from += sourceOffset; cell.to += sourceOffset; }
    value.height += topGap + bottomGap; value.top += topGap;
    value.mediaX = offsetX + (value.mediaX || 0); value.inset = offsetX;
    value.calloutTitle = header && !editingHeader ? { spec, x: indent, y: topGap + 5 } : null;
    value.calloutTopGap = topGap; value.calloutBottomGap = bottomGap;
    return value;
  }
  const style = row.type === 'heading' ? typography.headings?.[row.level - 1] : row.type.startsWith('code') ? codeStyle
    : row.tableCell ? row.header ? typography.tableHeader : typography.tableCell : typography.paragraph;
  const fontSize = style?.fontSize || (row.type === 'heading' ? Math.max(size, 32 - row.level * 2) : size);
  const lineHeight = style?.lineHeight || Math.ceil(fontSize * 1.7);
  let top = row.type === 'heading' ? 16 : 5, bottom = 7;
  if (style) {
    const previous = !row.previousBlock ? null : row.previousBlock.type === 'heading' ? typography.headings?.[row.previousBlock.level - 1] : typography.paragraph;
    const before = row.type === 'paragraph' && !row.paragraphStart || row.tableCell ? 0 : style.marginTop || 0;
    top = (style.paddingTop || 0) + Math.max(0, before - (previous?.marginBottom || 0));
    bottom = (style.paddingBottom || 0) + (row.type === 'paragraph' && !row.paragraphEnd || row.tableCell ? 0 : style.marginBottom || 0);
    if (row.calloutWrapped && row.type === 'paragraph') { top = 3; bottom = 3; }
    if (row.type === 'code') { top = 2; bottom = 2; }
  }
  if (row.type === 'blank' && !raw) return { height: .01, lines: [], top: 0, lineHeight, fontSize };
  if (row.type === 'rule' && !(raw && cursor > 0 && cursor < text.length)) {
    const rule = typography.rule || { color: '#8997b388', width: 1, marginTop: 14, marginBottom: 14 };
    return { height: rule.marginTop + rule.marginBottom + Math.max(1, rule.width), lines: [], top: 0, lineHeight, fontSize,
      rule: { ...rule, y: rule.marginTop } };
  }
  if (row.type === 'code-fence' && !(raw && cursor > 0)) {
    return { height: row.codeHeader ? 30 + (codeStyle.marginTop || 0) : 8 + (codeStyle.marginBottom || 0),
      lines: [], top: codeStyle.marginTop || 0, lineHeight, fontSize,
      codeBadge: row.codeHeader ? { language: row.language, y: codeStyle.marginTop || 0 } : null };
  }
  if (!raw && ['math-tail', 'table-separator'].includes(row.type)) return { height: 0.01, lines: [], top: 0, lineHeight, fontSize };
  if (row.type === 'table') {
    const parsed = tableCells(text), cellWidth = width / row.columns, cells = [], lines = [];
    const cellStyle = row.header ? typography.tableHeader : typography.tableCell;
    const paddingLeft = cellStyle?.paddingLeft ?? 8, paddingRight = cellStyle?.paddingRight ?? 8, offsetY = cellStyle ? 0 : 5;
    for (let i = 0; i < row.columns; i++) {
      const cell = parsed[i] || { text: '', from: text.length, to: text.length };
      const editing = raw && cursor >= cell.from - 1 && cursor <= cell.to + 1;
      const value = layoutSourceLine(ctx, cell.text, { type: 'paragraph', tableCell: true, header: row.header }, { width: Math.max(8, cellWidth - paddingLeft - paddingRight),
        raw: editing, cursor: cursor - cell.from,
        selection: selection ? { from: selection.from - cell.from, to: selection.to - cell.from } : null,
        font, size, asset, measure, typography, codeStyle });
      for (const line of value.lines) {
        const used = line.pieces.at(-1); const remaining = cellWidth - paddingLeft - paddingRight - (used ? used.x + used.width : 0);
        const offset = row.alignments[i] === 'right' ? remaining : row.alignments[i] === 'center' ? remaining / 2 : 0;
        line.pieces.forEach(p => { p.x += Math.max(0, offset); });
        lines.push({ ...line, top: line.top + offsetY, pieces: line.pieces.map(p => ({ ...p, x: p.x + i * cellWidth + paddingLeft,
          from: p.from + cell.from, to: p.to + cell.from })) });
      }
      cells.push({ ...cell, x: i * cellWidth, width: cellWidth, paddingLeft, offsetY, layout: value });
    }
    return { height: Math.max(...cells.map(c => c.layout.height)) + offsetY * 2, lines, cells, cellWidth, top: 0, lineHeight, fontSize };
  }
  if (!raw && (row.type === 'image' || row.type === 'math') && (row.tex !== undefined || row.url)) {
    const media = asset(row.type, row.tex || row.url, true);
    if (media?.image) {
      const ratio = Math.min(1, width / media.width, 1200 / media.height);
      return { height: media.height * ratio + 24, lines: [], media, mediaWidth: media.width * ratio,
        mediaHeight: media.height * ratio, mediaX: row.type === 'math' ? Math.max(0, (width - media.width * ratio) / 2) : 0,
        top: 12, lineHeight, fontSize };
    }
  }
  const lines = [];
  let pieces = [], x = 0, y = top, ascent = lineHeight * .8, descent = lineHeight * .2;
  const finish = () => {
    const height = ascent + descent;
    lines.push({ pieces, top: y, height, baseline: ascent }); y += height;
    x = 0; pieces = []; ascent = lineHeight * .8; descent = lineHeight * .2;
  };
  const headingPrefix = /^(#{1,6})\s+/.exec(text);
  const effectiveRaw = row.type === 'heading' && headingPrefix && (cursor === 0 || cursor >= headingPrefix[0].length) && selection?.from === selection?.to ? false : raw;
  for (const run of sourceRuns(text.replace(/\r$/, ''), row, effectiveRaw, cursor, selection)) {
    if (run.break) {
      pieces.push({ ...run, x, width: 0, font: `${fontSize}px ${font}` }); finish(); continue;
    }
    if (run.tex) {
      const media = asset('math', run.tex, false);
      if (media?.image) {
        const w = Math.min(width, media.width), h = media.height * w / media.width;
        if (x && x + w > width) finish();
        const scale = w / media.width, mediaAscent = (media.ascent ?? media.height * .8) * scale;
        const mediaDescent = (media.depth ?? media.height * .2) * scale;
        pieces.push({ ...run, x, width: w, media, height: h, ascent: mediaAscent }); x += w;
        ascent = Math.max(ascent, mediaAscent); descent = Math.max(descent, mediaDescent); continue;
      }
      // A pending or failed formula retains its complete delimiters. Do not
      // silently turn $\\alpha$ into bare text \\alpha while waiting for SVG.
      run.text = `$${run.tex}$`;
    }
    const f = `${run.italic || style?.fontStyle === 'italic' ? 'italic ' : ''}${run.bold ? '600' : style?.fontWeight || (row.type === 'heading' || row.header ? '600' : '400')} ${fontSize}px ${run.code ? codeStyle.fontFamily || 'Consolas, monospace' : style?.fontFamily || font}`;
    ctx.font = f;
    for (const { segment, index } of graphemes.segment(run.text)) {
      const display = segment === '\t' ? '    ' : segment;
      const w = measure(f, display);
      if (x && x + w > width) finish();
      pieces.push({ ...run, text: display, from: run.from + index, to: run.from + index + segment.length,
        x, width: w, font: f, color: run.token ? codeStyle.tokenColors?.[run.token] || style?.color : style?.color }); x += w;
    }
  }
  if (pieces.length || !lines.length) finish();
  return { height: y + bottom, lines, top, lineHeight, fontSize };
}

export function hitSource(layout, x, y, textLength) {
  if (layout.cells) {
    const cell = layout.cells.find(c => x < c.x + c.width) || layout.cells.at(-1);
    return cell.from + hitSource(cell.layout, x - cell.x - (cell.paddingLeft ?? 8), y - (cell.offsetY ?? 5) - (layout.tableTopGap || 0), cell.text.length);
  }
  if (!layout.lines.length) return x < (layout.mediaWidth || 0) / 2 ? 0 : textLength;
  const line = layout.lines.find(l => y < l.top + l.height) || layout.lines.at(-1);
  for (const p of line.pieces) {
    if (p.tex && x >= p.x && x < p.x + p.width) return x < p.x + p.width / 2 ? p.from + 1 : p.to - 1;
    if (x < p.x + p.width / 2) return p.from;
  }
  return line.pieces.at(-1)?.to ?? 0;
}

export function caretSource(layout, position) {
  if (layout.cells) {
    const cell = layout.cells.find(c => position <= c.to + 1) || layout.cells.at(-1);
    const caret = caretSource(cell.layout, Math.max(0, Math.min(cell.text.length, position - cell.from)));
    return { ...caret, x: cell.x + (cell.paddingLeft ?? 8) + caret.x, y: (cell.offsetY ?? 5) + caret.y + (layout.tableTopGap || 0) };
  }
  if (!layout.lines.length) return { x: (layout.mediaX || 0) + (position ? layout.mediaWidth || 0 : 0), y: layout.top, height: layout.lineHeight };
  let result;
  for (const line of layout.lines) {
    for (const piece of line.pieces) if (position >= piece.from && position <= piece.to) {
      result = { x: piece.x + (position === piece.to ? piece.width : 0), y: line.top, height: line.height };
    }
    if (!line.pieces.length && position === 0) result = { x: 0, y: line.top, height: line.height };
  }
  if (result) return result;
  const first = layout.lines[0], last = layout.lines.at(-1), piece = last.pieces.at(-1);
  if (position < (first.pieces[0]?.from ?? 0)) return { x: first.pieces[0]?.x || 0, y: first.top, height: first.height };
  return { x: piece ? piece.x + piece.width : 0, y: last.top, height: last.height };
}
