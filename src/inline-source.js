import { sourceLinks } from './navigation.js';

// Delimiters inside code and TeX are opaque to emphasis. Keep original offsets
// through recursive spans so clicking a rendered equation still opens its source.
function atomEnd(text, i, end) {
  if (text[i] === '`') {
    const marker = /^`+/.exec(text.slice(i))[0], close = text.indexOf(marker, i + marker.length);
    return close < 0 || close + marker.length > end ? null : { end: close + marker.length, from: i + marker.length, to: close, code: true };
  }
  if (text[i] !== '$' || text[i + 1] === '$' || text[i - 1] === '$') return null;
  for (let j = i + 1; j < end; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === '\n') break;
    if (text[j] === '$') return j > i + 1 ? { end: j + 1, from: i + 1, to: j, math: true } : null;
  }
  return null;
}
function emphasisEnd(text, start, end, marker) {
  for (let i = start; i < end;) {
    if (text[i] === '\\') { i += 2; continue; }
    const atom = atomEnd(text, i, end);
    if (atom) { i = atom.end; continue; }
    if (text[i] === marker[0]) {
      let next = i + 1; while (text[next] === marker[0]) next++;
      if (next - i === marker.length) return i;
      i = next;
    } else i++;
  }
  return -1;
}

export function inlineSourceRuns(text, start = 0) {
  const links = new Map(sourceLinks(text).map(link => [link.from, link]));
  function parse(from, end, style = {}, depth = 0) {
    const runs = []; let plain = from;
    const flush = to => { if (to > plain) runs.push({ ...style, text: text.slice(plain, to), from: plain, to }); };
    for (let i = from; i < end;) {
      if (text[i] === '\\') { i += 2; continue; }
      const atom = atomEnd(text, i, end);
      let next = i, fragments;
      if (atom) {
        const content = text.slice(atom.from, atom.to);
        fragments = [{ ...style, text: content, from: atom.math ? i : atom.from, to: atom.math ? atom.end : atom.to,
          ...(atom.math ? { tex: content } : { code: true }) }]; next = atom.end;
      } else if (links.has(i) && links.get(i).to <= end) {
        const link = links.get(i), labelEnd = text.indexOf('](', i);
        fragments = text[i] === '[' ? parse(i + 1, labelEnd, { ...style, link: link.href }, depth + 1)
          : [{ ...style, link: link.href, text: text.slice(i + 1, link.to - 1), from: i + 1, to: link.to - 1 }];
        next = link.to;
      } else if (text[i] === '<' && /^<br\s*\/?>/i.test(text.slice(i))) {
        next = i + /^<br\s*\/?>/i.exec(text.slice(i))[0].length;
        fragments = [{ ...style, text: '', break: true, from: i, to: next }];
      } else if (depth < 24 && (text[i] === '*' || text.startsWith('__', i))) {
        const marker = /^(\*{1,3}|__)/.exec(text.slice(i))[0], close = emphasisEnd(text, i + marker.length, end, marker);
        if (close > i + marker.length) {
          fragments = parse(i + marker.length, close, { ...style,
            ...(marker.length >= 2 ? { bold: true } : {}), ...(marker.length !== 2 ? { italic: true } : {}) }, depth + 1);
          next = close + marker.length;
        }
      }
      if (fragments) { flush(i); runs.push(...fragments); i = plain = next; } else i++;
    }
    flush(end); return runs;
  }
  return parse(start, text.length);
}
