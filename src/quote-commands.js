// Apply one source edit so continuation, splitting and exiting a quote each
// undo in one step. A caret before the marker can still insert a line above it.
export function enterQuote(model, rows) {
  const line = model.doc.lineAt(model.from), row = rows[line.number - 1];
  if (row?.type.startsWith('code') || model.doc.lineAt(model.to).number !== line.number) return null;
  const text = line.text.replace(/\r$/, '');
  const projection = row?.listProjection;
  const visiblePrefix = /^[\t ]*(?:>[\t ]*)+/.exec(projection?.text || text)?.[0];
  const prefixEnd = visiblePrefix && projection ? projection.map[visiblePrefix.length - 1] + 1 : visiblePrefix?.length;
  const prefix = prefixEnd ? text.slice(0, prefixEnd) : null;
  if (!prefix) return null;
  const eol = line.text.endsWith('\r') || model.doc.line(1).text.endsWith('\r') ? '\r\n' : '\n';
  const firstMarker = prefix.indexOf('>'), caret = model.from - line.from;
  if (caret <= firstMarker) return model.replaceSelection(eol);
  if (model.from === model.to && !text.slice(prefix.length).trim()) {
    // Empty nested quotes exit one level, preserving the outer quote.
    return model.replace(line.from + prefix.lastIndexOf('>'), line.from + text.length, '');
  }
  // An item starting with "- >" keeps its list indentation on the new quote
  // line. It must not repeat the list marker and create a sibling item.
  let continuation = prefix;
  if (row?.list?.first && row.list.originalMarkerFrom < prefix.length) {
    const from = row.list.originalMarkerFrom, to = row.list.originalContentFrom;
    continuation = prefix.slice(0, from) + ' '.repeat(to - from) + prefix.slice(to);
  }
  return model.replaceSelection(eol + continuation + (prefix.endsWith('>') ? ' ' : ''));
}
