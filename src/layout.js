export const FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';
export const MONO = 'Consolas, "Microsoft YaHei", monospace';
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

export class LruCache {
  constructor(limit) { this.limit = limit; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key); this.map.set(key, value);
    return value;
  }
  set(key, value) {
    this.map.delete(key); this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
    return value;
  }
  clear() { this.map.clear(); }
  delete(key) { return this.map.delete(key); }
  get size() { return this.map.size; }
}

export function metrics(block) {
  const size = block.type === 'heading' ? [0, 30, 26, 23, 21, 19, 18][block.level] : block.type === 'code' ? 14 : 17;
  return { size, lineHeight: Math.ceil(size * 1.7), top: block.type === 'heading' ? 20 : 10, bottom: 12 };
}

export function estimateHeight(block, width) {
  if (block.type === 'rule') return 30;
  const m = metrics(block);
  const available = Math.max(60, width - (block.indent || 0) * 20 - (block.quote ? 20 : 0) - 24);
  const chars = Math.max(1, Math.floor(available / m.size));
  const text = block.type === 'table' ? block.cells.map(c => c.map(r => r.text).join('')).sort((a,b) => b.length-a.length)[0] || '' : block.text;
  const lineWidth = block.type === 'table' ? Math.max(1, chars / Math.max(1, block.cells.length)) : chars;
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / lineWidth)), 0);
  return m.top + m.bottom + lines * m.lineHeight;
}

export function layoutBlock(ctx, block, width, measureCache) {
  if (block.type === 'rule') return { height: 30, lines: [] };
  const m = metrics(block);
  const indent = Math.min((block.indent || 0) * 20 + (block.quote ? 20 : 0), width / 3);
  const inset = block.type === 'code' ? 12 : 0;
  const available = Math.max(24, width - indent - inset * 2);
  const wrap = (runs, maxWidth, offset = 0) => {
    const lines = [];
    let pieces = [], x = 0;
    const flush = () => { lines.push(pieces); pieces = []; x = 0; };
    const place = (text, run, font, measured) => {
      if (x && x + measured > maxWidth) flush();
      pieces.push({ text, x: offset + x, width: measured, font, link: run.link, code: run.code, strike: run.strike });
      x += measured;
    };
    for (const run of runs) {
      const font = `${run.italic ? 'italic ' : ''}${run.bold || block.type === 'heading' || block.header ? '600' : '400'} ${m.size}px ${run.code ? MONO : FONT}`;
      ctx.font = font;
      const measure = text => {
        const key = `${font}\0${text}`;
        let value = measureCache.get(key);
        if (value === undefined) value = measureCache.set(key, ctx.measureText(text).width);
        return value;
      };
      for (const { segment } of segmenter.segment(run.text)) {
        if (segment.includes('\n')) {
          const parts = segment.split('\n');
          parts.forEach((part, i) => { if (i) flush(); if (part) place(part, run, font, measure(part)); });
        } else {
          const measured = measure(segment);
          if (measured <= maxWidth) place(segment, run, font, measured);
          else for (const char of segment) place(char, run, font, measure(char));
        }
      }
    }
    if (pieces.length || !lines.length) flush();
    return lines;
  };
  if (block.type === 'table') {
    const cellWidth = available / Math.max(1, block.cells.length);
    const cells = block.cells.map((runs, i) => wrap(runs, Math.max(8, cellWidth - 16), indent + i * cellWidth + 8));
    const count = Math.max(1, ...cells.map(c => c.length));
    return { ...m, indent, cellWidth, cells, height: m.top + m.bottom + count * m.lineHeight };
  }
  const lines = wrap(block.runs, available, indent + inset);
  return { ...m, indent, lines, height: m.top + m.bottom + lines.length * m.lineHeight };
}
