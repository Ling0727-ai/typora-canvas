// Apply one source edit so continuation, splitting and exiting a quote each
// undo in one step. A caret before the marker can still insert a line above it.
export function enterQuote(model, rows) {
  const line = model.doc.lineAt(model.from), row = rows[line.number - 1];
  if (row?.type.startsWith('code') || model.doc.lineAt(model.to).number !== line.number) return null;
  const text = line.text.replace(/\r$/, ''), prefix = /^[\t ]*(?:>[\t ]*)+/.exec(text)?.[0];
  if (!prefix) return null;
  const eol = line.text.endsWith('\r') || model.doc.line(1).text.endsWith('\r') ? '\r\n' : '\n';
  const firstMarker = prefix.indexOf('>'), caret = model.from - line.from;
  if (caret <= firstMarker) return model.replaceSelection(eol);
  if (model.from === model.to && !text.slice(prefix.length).trim()) {
    // Empty nested quotes exit one level, preserving the outer quote.
    return model.replace(line.from + prefix.lastIndexOf('>'), line.from + text.length, '');
  }
  return model.replaceSelection(eol + prefix + (prefix.endsWith('>') ? ' ' : ''));
}
