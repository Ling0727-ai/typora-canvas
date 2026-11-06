import { parseListMarker, formatListMarker } from './list-syntax.js';

// Continue/split/exit and renumber siblings in a single source transaction.
// Nested lists keep their counters and source; unrelated lists are untouched.
export function enterList(model, rows) {
  const line = model.doc.lineAt(model.from), row = rows[line.number - 1], item = row?.list;
  if (!item || row.type.startsWith('code') || model.doc.lineAt(model.to).number !== line.number) return null;
  const projected = row.listProjection?.text || line.text;
  const first = model.doc.line(item.start + 1), markerFrom = item.originalMarkerFrom;
  const outerQuotes = (first.text.slice(0, markerFrom).match(/>/g) || []).length;
  const currentQuotes = (/^[\t ]*(?:>[\t ]*)*/.exec(projected)?.[0].match(/>/g) || []).length;
  if (!item.first && currentQuotes > outerQuotes || row.calloutHeader) return null;
  const marker = parseListMarker(first.text.slice(markerFrom), item.marker);
  if (!marker) return null;
  // A quote/Callout beginning in an item continues as a quote, not a new item.
  if (/^[\t ]*>/.test(first.text.slice(item.originalContentFrom)) && item.first) return null;
  const caret = model.from - line.from;
  const eol = line.text.endsWith('\r') || model.doc.line(1).text.endsWith('\r') ? '\r\n' : '\n';
  if (item.first && caret <= markerFrom) return model.replaceSelection(eol);
  const text = line.text.replace(/\r$/, '');
  const empty = item.first && model.from === model.to && !text.slice(item.originalContentFrom).trim();
  const prefix = first.text.slice(0, markerFrom), nextMarker = formatListMarker(marker, item.number + 1);
  const from = empty ? line.from + markerFrom : model.from;
  const to = empty ? line.from + text.length : model.to;
  const insert = empty ? '' : eol + prefix + nextMarker + ' ';
  const edits = [{ from, to, text: insert }], group = item.groups.at(-1);
  function shiftContinuation(start, end, delta) {
    if (!delta) return;
    for (let i = start; i <= end; i++) {
      const current = model.doc.line(i + 1);
      if (!current.text.trim()) continue;
      const range = rows[i]?.listRanges?.find(r => r.depth === item.depth);
      if (!range) continue;
      const at = current.from + range.to;
      if (delta > 0) edits.push({ from: at, to: at, text: ' '.repeat(delta) });
      else if (/^ +$/.test(current.text.slice(range.to + delta, range.to))) edits.push({ from: at + delta, to: at, text: '' });
    }
  }
  if (!empty) shiftContinuation(line.number, item.end, nextMarker.length - marker.raw.length);
  for (let i = line.number; i <= group.end; i++) {
    const next = rows[i]?.list;
    if (!next || !next.first || next.groups.at(-1) !== group) continue;
    const sibling = model.doc.line(i + 1), at = sibling.from + next.originalMarkerFrom;
    const old = parseListMarker(sibling.text.slice(next.originalMarkerFrom), item.marker);
    if (!old || !old.ordered) continue;
    const replacement = formatListMarker(marker, next.number + (empty ? -1 : 1));
    edits.push({ from: at, to: at + old.raw.length, text: replacement });
    shiftContinuation(i + 1, next.end, replacement.length - old.raw.length);
  }
  const end = Math.max(...edits.map(e => e.to));
  let replacement = model.doc.sliceString(from, end);
  for (const edit of edits.sort((a, b) => b.from - a.from)) replacement = replacement.slice(0, edit.from - from) + edit.text + replacement.slice(edit.to - from);
  const position = from + insert.length;
  return model.replace(from, end, replacement, { anchor: position, head: position });
}
