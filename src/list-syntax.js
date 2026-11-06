const romanDigits = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
export function counterText(number, kind = 'decimal') {
  if (kind.includes('alpha')) {
    let value = '';
    for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(97 + (n - 1) % 26) + value;
    return kind.startsWith('upper') ? value.toUpperCase() : value;
  }
  if (kind.includes('roman') && number > 0 && number < 4000) {
    let value = '', n = number;
    for (const [v, s] of romanDigits) while (n >= v) { value += s; n -= v; }
    return kind.startsWith('upper') ? value.toUpperCase() : value;
  }
  return kind === 'decimal-leading-zero' ? String(number).padStart(2, '0') : String(number);
}
function romanNumber(value) {
  let n = 0, previous = 0;
  for (const c of value.toLowerCase().split('').reverse()) {
    const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }[c];
    if (!v) return null;
    n += v < previous ? -v : v; previous = Math.max(previous, v);
  }
  return n > 0 && n < 4000 && counterText(n, 'lower-roman') === value.toLowerCase() ? n : null;
}
// A list's first marker chooses its alphabet. Subsequent c./i./v. markers
// inherit that choice, avoiding a switch to Roman numbers halfway through a-z.
export function parseListMarker(text, expected = null) {
  const bullet = /^[-+*](?=[\t ]|$)/.exec(text);
  if (bullet) return { ordered: false, raw: bullet[0], number: 1, kind: 'bullet', open: '', close: bullet[0] };
  const match = /^(\()?([0-9]{1,9}|[a-zA-Z]{1,8})([.)])(?=[\t ]|$)/.exec(text);
  if (!match || match[1] && match[3] !== ')') return null;
  const value = match[2], upper = value === value.toUpperCase(), roman = romanNumber(value);
  let kind, number;
  if (/^\d+$/.test(value)) { kind = 'decimal'; number = Number(value); }
  else {
    if (value !== value.toLowerCase() && !upper) return null;
    const asRoman = expected?.kind?.includes('roman') || !expected && roman && (value.length > 1 || /^[ivx]$/i.test(value));
    if (asRoman) { if (!roman) return null; kind = upper ? 'upper-roman' : 'lower-roman'; number = roman; }
    else { if (value.length > 2) return null; kind = upper ? 'upper-alpha' : 'lower-alpha'; number = [...value.toLowerCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 96, 0); }
  }
  return { ordered: true, raw: match[0], number, kind, open: match[1] || '', close: match[3], extended: !!match[1] || kind !== 'decimal' };
}
export function formatListMarker(marker, number) {
  return marker.ordered ? marker.open + counterText(number, marker.kind) + marker.close : marker.raw;
}
