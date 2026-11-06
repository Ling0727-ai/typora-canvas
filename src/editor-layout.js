const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
import { tableCells } from './editor-model.js';
export const editorFont = '"Segoe UI", "Microsoft YaHei", sans-serif';

// Inactive lines elide common Markdown markers; the active source line is exact.
// Every visible fragment retains its UTF-16 source range for pointer hit testing.
export function sourceRuns(text, row, raw, cursor = -1, selection = null) {
  if (row.type === 'code') return [{ text, from: 0, to: text.length, code: true }];
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
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|\$([^$\n]+)\$/g;
  let consumed = start, match;
  pattern.lastIndex = start;
  while ((match = pattern.exec(text))) {
    if (match.index > consumed) runs.push({ text: text.slice(consumed, match.index), from: consumed, to: match.index });
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

export function layoutSourceLine(ctx, text, row, { width, raw, font = editorFont, size = 17, asset, measure, cursor = -1, selection = null }) {
  const fontSize = row.type === 'heading' ? Math.max(size, 32 - row.level * 2) : size;
  const lineHeight = Math.ceil(fontSize * 1.7), top = row.type === 'heading' ? 16 : 5, bottom = 7;
  if (!raw && ['math-tail', 'table-separator'].includes(row.type)) return { height: 0.01, lines: [], top: 0, lineHeight, fontSize };
  if (row.type === 'table') {
    const parsed = tableCells(text), cellWidth = width / row.columns, cells = [], lines = [];
    for (let i = 0; i < row.columns; i++) {
      const cell = parsed[i] || { text: '', from: text.length, to: text.length };
      const editing = raw && cursor >= cell.from - 1 && cursor <= cell.to + 1;
      const value = layoutSourceLine(ctx, cell.text, { type: 'paragraph', header: row.header }, { width: Math.max(8, cellWidth - 16),
        raw: editing, cursor: cursor - cell.from,
        selection: selection ? { from: selection.from - cell.from, to: selection.to - cell.from } : null,
        font, size, asset, measure });
      for (const line of value.lines) {
        const used = line.pieces.at(-1); const remaining = cellWidth - 16 - (used ? used.x + used.width : 0);
        const offset = row.alignments[i] === 'right' ? remaining : row.alignments[i] === 'center' ? remaining / 2 : 0;
        line.pieces.forEach(p => { p.x += Math.max(0, offset); });
        lines.push({ ...line, top: line.top + 5, pieces: line.pieces.map(p => ({ ...p, x: p.x + i * cellWidth + 8,
          from: p.from + cell.from, to: p.to + cell.from })) });
      }
      cells.push({ ...cell, x: i * cellWidth, width: cellWidth, layout: value });
    }
    return { height: Math.max(...cells.map(c => c.layout.height)) + 10, lines, cells, cellWidth, top: 0, lineHeight, fontSize };
  }
  if (!raw && (row.type === 'image' || row.type === 'math') && (row.tex !== undefined || row.url)) {
    const media = asset(row.type, row.tex || row.url, true);
    if (media?.image) {
      const ratio = Math.min(1, width / media.width, 1200 / media.height);
      return { height: media.height * ratio + 24, lines: [], media, mediaWidth: media.width * ratio,
        mediaHeight: media.height * ratio, top: 12, lineHeight, fontSize };
    }
  }
  const lines = [];
  let pieces = [], x = 0, y = top, lineMax = lineHeight;
  const finish = () => { lines.push({ pieces, top: y, height: lineMax }); y += lineMax; x = 0; pieces = []; lineMax = lineHeight; };
  for (const run of sourceRuns(text.replace(/\r$/, ''), row, raw, cursor, selection)) {
    if (run.tex) {
      const media = asset('math', run.tex, false);
      if (media?.image) {
        const w = Math.min(width, media.width), h = media.height * w / media.width;
        if (x && x + w > width) finish();
        pieces.push({ ...run, x, width: w, media, height: h }); x += w; lineMax = Math.max(lineMax, h + 4); continue;
      }
      // A pending or failed formula retains its complete delimiters. Do not
      // silently turn $\\alpha$ into bare text \\alpha while waiting for SVG.
      run.text = `$${run.tex}$`;
    }
    const f = `${run.italic ? 'italic ' : ''}${run.bold || row.type === 'heading' || row.header ? '600' : '400'} ${row.type === 'code' ? Math.max(12, size - 2) : fontSize}px ${run.code ? 'Consolas, monospace' : font}`;
    ctx.font = f;
    for (const { segment, index } of graphemes.segment(run.text)) {
      const display = segment === '\t' ? '    ' : segment;
      const w = measure(f, display);
      if (x && x + w > width) finish();
      pieces.push({ ...run, text: display, from: run.from + index, to: run.from + index + segment.length,
        x, width: w, font: f }); x += w;
    }
  }
  if (pieces.length || !lines.length) finish();
  return { height: y + bottom, lines, top, lineHeight, fontSize };
}

export function hitSource(layout, x, y, textLength) {
  if (layout.cells) {
    const cell = layout.cells.find(c => x < c.x + c.width) || layout.cells.at(-1);
    return cell.from + hitSource(cell.layout, x - cell.x - 8, y - 5, cell.text.length);
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
    return { ...caret, x: cell.x + 8 + caret.x, y: 5 + caret.y };
  }
  if (!layout.lines.length) return { x: position ? layout.mediaWidth || 0 : 0, y: layout.top, height: layout.lineHeight };
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
