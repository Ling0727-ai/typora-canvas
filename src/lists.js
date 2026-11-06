import MarkdownIt from 'markdown-it';
const markdown = new MarkdownIt({ html: false });
const marker = /^([\t ]*(?:>[\t ]*)*)([\t ]*)([-+*]|\d{1,9}[.)])(?:[\t ]+|$)/;

// Use the block parser's scopes and counters, rather than treating every
// marker-looking physical line as a separate paragraph or independent number.
export function markLists(doc, rows) {
  if (!rows.some(r => ['paragraph', 'quote'].includes(r.type) && marker.test(r.content))) return;
  const source = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text).join('\n');
  const lists = [], items = [];
  let paragraph = null;
  for (const token of markdown.parse(source, {})) {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      lists.push({ tag: token.tag, next: Number(token.attrGet('start') || 1), start: token.map[0], end: token.map[1] - 1 });
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') lists.pop();
    else if (token.type === 'list_item_open' && lists.length) {
      const group = lists.at(-1), first = rows[token.map[0]], match = marker.exec(first?.content || '');
      const item = { start: token.map[0], end: token.map[1] - 1, number: group.next++, groups: [...lists],
        path: lists.map(g => g.tag).join('/'), depth: lists.length - 1, ordered: group.tag === 'ol',
        markerFrom: match ? match[1].length + match[2].length : 0, contentFrom: match?.[0].length || 0 };
      items.push(item);
    } else if (token.type === 'list_item_close') items.pop();
    else if (token.type === 'paragraph_open') paragraph = { loose: !token.hidden, start: token.map[0], end: token.map[1] - 1 };
    else if (token.type === 'paragraph_close') paragraph = null;
    else if (token.type === 'inline' && items.length && paragraph && token.map) {
      const item = items.at(-1), parts = token.content.split('\n');
      for (let i = token.map[0]; i < token.map[1]; i++) {
        const row = rows[i];
        if (!row || !['paragraph', 'quote'].includes(row.type) || row.calloutHeader) continue;
        const first = i === item.start, part = parts[i - token.map[0]] || '';
        const contentFrom = first ? item.contentFrom : Math.max(0, row.content.lastIndexOf(part));
        row.list = { ...item, first, contentFrom, loose: paragraph.loose,
          paragraphStart: i === paragraph.start, paragraphEnd: i === paragraph.end };
      }
    }
  }
  // Token maps may include separator blank lines. Container margins belong to
  // the last rendered list line, never to a following body blank paragraph.
  const bounds = new Map();
  for (const row of rows) for (const group of row.list?.groups || []) {
    if (!bounds.has(group)) bounds.set(group, row.sourceLine);
    group.start = bounds.get(group); group.end = row.sourceLine;
  }
}

function letters(number) {
  let value = ''; for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(97 + (n - 1) % 26) + value;
  return value;
}
export function listMarker(list, type) {
  if (type === 'none') return '';
  if (!list.ordered) return ({ circle: '◦', square: '▪', disc: '•' })[type] || '•';
  let value = String(list.number);
  if (['lower-alpha', 'lower-latin', 'upper-alpha', 'upper-latin'].includes(type)) value = letters(list.number);
  if (['lower-roman', 'upper-roman'].includes(type) && list.number > 0 && list.number < 4000) {
    let n = list.number; value = '';
    for (const [v, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']])
      while (n >= v) { value += s; n -= v; }
  }
  if (type === 'decimal-leading-zero') value = value.padStart(2, '0');
  if (type?.startsWith('upper-')) value = value.toUpperCase();
  return value + '.';
}
