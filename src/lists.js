import MarkdownIt from 'markdown-it';
import listBlock from './list-block.js';
import { counterText } from './list-syntax.js';
export function useCanvasLists(md) { md.block.ruler.at('list', listBlock, { alt: ['paragraph', 'reference', 'blockquote'] }); return md; }
const markdown = useCanvasLists(new MarkdownIt({ html: false }));

// Source ranges are recorded while Markdown's block parser is inside each
// container. Strip them only in a projection: the editable rope stays verbatim.
export function projectListLine(text, ranges = [], depth = Infinity) {
  const remove = new Uint8Array(text.length);
  for (const range of ranges) if (range.depth < depth) remove.fill(1, range.from, range.to);
  let value = ''; const map = [];
  for (let i = 0; i < text.length; i++) if (!remove[i]) { map.push(i); value += text[i]; }
  map.push(text.length);
  return { text: value, map };
}
export function scanLists(doc) {
  const lines = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text);
  if (!lines.some(text => /(?:^|[\t >])(?:[-+*]|\(?\d{1,9}[.)]|\(?[A-Za-z]{1,8}[.)])(?:[\t ]|\r?$)/.test(text))) return null;
  const env = {}, tokens = markdown.parse(lines.join('\n'), env), lists = [], items = [], metadata = new Array(lines.length);
  let paragraph = null;
  for (const token of tokens) {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      lists.push({ tag: token.tag, marker: token.meta?.marker, next: Number(token.attrGet('start') || 1), start: token.map[0], end: token.map[1] - 1 });
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') lists.pop();
    else if (token.type === 'list_item_open' && lists.length) {
      const group = lists.at(-1);
      const item = { start: token.map[0], end: token.map[1] - 1, number: group.next++, groups: [...lists],
        ancestors: [...items.map(item => item.start), token.map[0]],
        path: lists.map(g => g.tag).join('/'), depth: lists.length - 1, ordered: group.tag === 'ol',
        marker: group.marker, ...token.meta };
      items.push(item);
      for (let i = item.start; i <= item.end; i++) metadata[i] = { ...item, first: i === item.start, contentFrom: i === item.start ? item.contentFrom : 0 };
    } else if (token.type === 'list_item_close') items.pop();
    else if (token.type === 'paragraph_open') paragraph = { loose: !token.hidden, start: token.map[0], end: token.map[1] - 1 };
    else if (token.type === 'paragraph_close') paragraph = null;
    else if (token.type === 'inline' && items.length && paragraph && token.map) {
      for (let i = token.map[0]; i < token.map[1]; i++) if (metadata[i]) Object.assign(metadata[i], {
        loose: paragraph.loose, paragraphStart: i === paragraph.start, paragraphEnd: i === paragraph.end });
    }
  }
  const projections = lines.map((text, i) => projectListLine(text, env.canvasListRemovals?.[i]));
  return { metadata, projections, removals: env.canvasListRemovals || [], lines };
}
export function markLists(doc, rows, scan = scanLists(doc)) {
  if (!scan) return;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], list = scan.metadata[i];
    if (!list) continue;
    if (row.type === 'blank' && !list.first) continue;
    const projection = scan.projections[i], offset = row.sourceOffset || 0;
    row.listProjection = projection;
    row.listRanges = scan.removals[i] || [];
    row.list = { ...list, markerFrom: Math.max(0, list.markerFrom - offset),
      contentFrom: Math.max(0, (list.first ? list.contentFrom : projection.map[0]) - offset),
      originalMarkerFrom: list.markerFrom, originalContentFrom: list.contentFrom };
    if (list.first && row.type === 'blank') row.type = 'paragraph';
  }
  const bounds = new Map();
  for (const row of rows) for (const group of row.list?.groups || []) {
    if (!bounds.has(group)) bounds.set(group, row.sourceLine);
    group.start = bounds.get(group); group.end = row.sourceLine;
  }
}
export function listStyles(list, typography, size) {
  const paths = list.path.split('/');
  return paths.map((tag, i) => typography.lists?.[paths.slice(0, i + 1).join('/')]
    || typography.lists?.[paths.slice(Math.max(0, i - 2), i + 1).join('/')] || {
      paddingLeft: size * 2, marginLeft: 0, marginTop: 0, marginBottom: 0,
      item: typography.paragraph || {}, marker: {}, listStyleType: tag === 'ol' ? 'decimal' : ['disc', 'circle', 'square'][i % 3] });
}
export function listInset(list, typography, size, depth = Infinity) {
  return listStyles(list, typography, size).slice(0, depth).reduce((sum, s) => sum + (s.paddingLeft ?? size * 2) + (s.marginLeft || 0) + (s.item?.paddingLeft || 0), 0);
}
export function listMarker(list, type) {
  if (type === 'none') return '';
  if (!list.ordered) return ({ circle: '◦', square: '▪', disc: '•' })[type] || '•';
  const marker = list.marker;
  const kind = marker?.extended ? marker.kind : type?.replace('latin', 'alpha') || 'decimal';
  return (marker?.open || '') + counterText(list.number, kind) + (marker?.close || '.');
}
