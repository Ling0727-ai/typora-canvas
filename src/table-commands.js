import { tableCells } from './editor-model.js';

export function tableContext(doc, rows, head, anchor = head) {
  const line = doc.lineAt(head), index = line.number - 1, meta = rows[index];
  if (meta?.tableStart === undefined || rows[doc.lineAt(anchor).number - 1]?.tableStart !== meta.tableStart) return null;
  const header = rows[meta.tableStart], cells = tableCells(line.text.slice(meta.sourceOffset || 0));
  const local = head - line.from - (meta.sourceOffset || 0);
  let column = cells.findIndex(c => local <= c.to + 1);
  if (column < 0) column = cells.length - 1;
  return { start: meta.tableStart, end: meta.tableEnd, row: Math.max(0, meta.tableRow),
    column: Math.max(0, Math.min(header.columns - 1, column)), columns: header.columns,
    rowCount: meta.tableEnd - meta.tableStart, alignments: header.alignments };
}

export function cellRange(doc, rows, context, row = context.row, column = context.column) {
  const index = context.start + (row === 0 ? 0 : row + 1);
  const line = doc.line(index + 1), offset = rows[index].sourceOffset || 0;
  const cells = tableCells(line.text.slice(offset)), cell = cells[column] || { from: line.text.replace(/\r$/, '').length - offset, to: line.text.replace(/\r$/, '').length - offset };
  return { from: line.from + offset + cell.from, to: line.from + offset + cell.to, line: index };
}

export function tableArrowTarget(doc, rows, head, anchor, key) {
  const context = tableContext(doc, rows, head, anchor);
  if (!context) return null;
  const range = cellRange(doc, rows, context), horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  if (horizontal && (head !== anchor || direction < 0 && head > range.from || direction > 0 && head < range.to)) return null;
  let { row, column } = context;
  if (horizontal) {
    column += direction;
    if (column < 0) { column = context.columns - 1; row--; }
    if (column >= context.columns) { column = 0; row++; }
  } else row += direction;
  if (row < 0 || row >= context.rowCount) return { exit: direction, context };
  const target = cellRange(doc, rows, context, row, column);
  return { position: horizontal ? direction < 0 ? target.to : target.from
    : Math.min(target.to, target.from + Math.max(0, head - range.from)) };
}

function readTable(doc, rows, context) {
  const records = [];
  for (let i = context.start; i <= context.end; i++) {
    const line = doc.line(i + 1), offset = rows[i].sourceOffset || 0, content = line.text.slice(offset);
    const prefix = line.text.slice(0, offset) + (/^\s*/.exec(content)?.[0] || '');
    if (i !== context.start + 1) records.push({ prefix, cells: tableCells(content).map(c => c.text) });
  }
  const first = doc.line(context.start + 1), last = doc.line(context.end + 1), separator = doc.line(context.start + 2);
  const offset = rows[context.start + 1].sourceOffset || 0;
  return { records, separatorPrefix: separator.text.slice(0, offset) + (/^\s*/.exec(separator.text.slice(offset))?.[0] || ''),
    alignments: [...context.alignments], columns: context.columns, from: first.from, to: last.to,
    eol: first.text.endsWith('\r') ? '\r\n' : '\n', lastCR: last.text.endsWith('\r') };
}
const separatorCell = alignment => alignment === 'center' ? ':---:' : alignment === 'right' ? '---:' : ':---';
export function tableSource(doc, rows, head, anchor = head) {
  const context = tableContext(doc, rows, head, anchor); if (!context) throw new Error('请先将光标放入表格');
  return doc.sliceString(doc.line(context.start + 1).from, doc.line(context.end + 1).to);
}

// Each operation is one immutable document replacement / one undo step.
// Only the selected table is serialized; other Markdown stays byte-for-byte.
export function editTable(model, rows, action, options = {}) {
  const context = tableContext(model.doc, rows, model.head, model.anchor);
  if (!context) throw new Error('请先将光标放入表格');
  const table = readTable(model.doc, rows, context);
  let targetRow = context.row, targetColumn = context.column;
  const blank = prefix => ({ prefix, cells: Array(table.columns).fill('') });
  const removeTable = () => {
    const to = table.to < model.length ? table.to + 1 : table.to;
    return model.replace(table.from, to, '', { anchor: table.from, head: table.from });
  };
  if (action === 'delete-table') return removeTable();
  if (action === 'align') {
    if (!['left', 'center', 'right'].includes(options.align)) throw new Error('无效的对齐方式');
    table.alignments[targetColumn] = options.align;
    const separator = model.doc.line(context.start + 2);
    const text = table.separatorPrefix + '| ' + table.alignments.map(separatorCell).join(' | ') + ' |' + (separator.text.endsWith('\r') ? '\r' : '');
    const oldLength = separator.to - separator.from, delta = text.length - oldLength;
    const oldCells = tableCells(separator.text.slice(table.separatorPrefix.length));
    const newCells = tableCells(text.slice(table.separatorPrefix.length));
    const adjust = position => {
      if (position > separator.to) return position + delta;
      if (position < separator.from) return position;
      const relative = position - separator.from - table.separatorPrefix.length - (oldCells[targetColumn]?.from || 0);
      const cell = newCells[targetColumn];
      return separator.from + table.separatorPrefix.length + cell.from + Math.max(0, Math.min(relative, cell.text.length));
    };
    return model.replace(separator.from, separator.to, text, { anchor: adjust(model.anchor), head: adjust(model.head) });
  }
  if (action === 'resize') {
    const rowCount = Number(options.rows), columnCount = Number(options.columns);
    if (!Number.isInteger(rowCount) || !Number.isInteger(columnCount) || rowCount < 1 || columnCount < 1 || rowCount > 10000 || columnCount > 200) {
      throw new Error('行数需为 1–10000，列数需为 1–200（行数包含表头）');
    }
    while (table.records.length < rowCount) table.records.push(blank(table.records.at(-1).prefix));
    table.records.length = rowCount;
    table.columns = columnCount;
    table.alignments = Array.from({ length: columnCount }, (_, i) => table.alignments[i] || 'left');
    table.records.forEach(record => { record.cells = Array.from({ length: columnCount }, (_, i) => record.cells[i] || ''); });
  } else if (action === 'insert-row-above' || action === 'insert-row-below') {
    const at = action.endsWith('above') ? Math.max(1, targetRow) : targetRow + 1;
    table.records.splice(at, 0, blank(table.records[targetRow].prefix)); targetRow = at;
  } else if (action === 'delete-row') {
    if (table.records.length === 1) return removeTable();
    table.records.splice(targetRow, 1); targetRow = Math.min(targetRow, table.records.length - 1);
  } else if (action === 'insert-column-left' || action === 'insert-column-right') {
    const at = targetColumn + (action.endsWith('right') ? 1 : 0);
    table.records.forEach(record => { while (record.cells.length < table.columns) record.cells.push(''); record.cells.splice(at, 0, ''); });
    table.alignments.splice(at, 0, 'left'); table.columns++; targetColumn = at;
  } else if (action === 'delete-column') {
    if (table.columns === 1) return removeTable();
    table.records.forEach(record => record.cells.splice(targetColumn, 1));
    table.alignments.splice(targetColumn, 1); table.columns--; targetColumn = Math.min(targetColumn, table.columns - 1);
  } else if (action.startsWith('move-column-')) {
    const to = targetColumn + (action.endsWith('left') ? -1 : 1);
    if (to < 0 || to >= table.columns) return null;
    table.records.forEach(record => {
      while (record.cells.length < table.columns) record.cells.push('');
      [record.cells[targetColumn], record.cells[to]] = [record.cells[to], record.cells[targetColumn]];
    });
    [table.alignments[targetColumn], table.alignments[to]] = [table.alignments[to], table.alignments[targetColumn]];
    targetColumn = to;
  } else if (action.startsWith('move-row-')) {
    const to = targetRow + (action.endsWith('up') ? -1 : 1);
    if (targetRow === 0 || to < 1 || to >= table.records.length) return null;
    [table.records[targetRow], table.records[to]] = [table.records[to], table.records[targetRow]]; targetRow = to;
  } else if (action !== 'format') throw new Error(`未知表格操作：${action}`);
  targetRow = Math.min(targetRow, table.records.length - 1); targetColumn = Math.min(targetColumn, table.columns - 1);
  const lines = table.records.map(record => {
    const cells = [...record.cells]; while (cells.length < table.columns) cells.push('');
    return record.prefix + '| ' + cells.join(' | ') + ' |';
  });
  lines.splice(1, 0, table.separatorPrefix + '| ' + table.alignments.map(separatorCell).join(' | ') + ' |');
  const physical = targetRow === 0 ? 0 : targetRow + 1;
  let position = table.from + lines.slice(0, physical).reduce((sum, line) => sum + line.length + table.eol.length, 0);
  const record = table.records[targetRow];
  position += record.prefix.length + 2 + record.cells.slice(0, targetColumn).reduce((sum, cell) => sum + cell.length + 3, 0);
  const source = lines.join(table.eol) + (table.lastCR ? '\r' : '');
  return model.replace(table.from, table.to, source, { anchor: position, head: position });
}
