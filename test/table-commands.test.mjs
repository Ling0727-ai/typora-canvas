import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines, tableCells } from '../src/editor-model.js';
import { tableContext, cellRange, editTable } from '../src/table-commands.js';
import { layoutSourceLine } from '../src/editor-layout.js';

const source = 'Before\n\n| Name | Math |\n| --- | :---: |\n| a\\|b | $\\alpha$ |\n| `x|y` | $\\frac{1}{2}$ |\n\nAfter';
function setup(text = source) {
  const model = new CanvasDocument(text), rows = classifyLines(model.doc);
  const first = rows.findIndex(r => r.type === 'table');
  model.select(model.doc.line(first + 3).from + (rows[first + 2].sourceOffset || 0) + 2);
  return { model, rows };
}

test('table metadata, active cell and ranges work inside Callouts', () => {
  const { model, rows } = setup('> [!note] Table\n> | A | B |\n> | --- | --- |\n> | x | y |');
  const context = tableContext(model.doc, rows, model.head);
  assert.deepEqual([context.start, context.end, context.row, context.columns, context.rowCount], [1, 3, 1, 2, 2]);
  const range = cellRange(model.doc, rows, context, 1, 1);
  assert.equal(model.doc.sliceString(range.from, range.to), 'y');
  assert.equal(tableContext(model.doc, rows, 0), null);
});

test('alignment changes only the separator, preserves formulas and is one undo step', () => {
  const { model, rows } = setup();
  editTable(model, rows, 'align', { align: 'right' });
  assert.equal(model.getText(), source.replace('| --- | :---: |', '| ---: | :---: |'));
  assert.equal(model.undoStack.length, 1); model.undo(); assert.equal(model.getText(), source);
});

test('alignment while editing the separator retains the selected column', () => {
  const { model, rows } = setup();
  const separator = model.doc.line(4);
  model.select(separator.from + separator.text.indexOf(':---:') + 2);
  editTable(model, rows, 'align', { align: 'right' });
  const next = classifyLines(model.doc);
  assert.equal(tableContext(model.doc, next, model.head).column, 1);
  assert.deepEqual(next[2].alignments, ['left', 'right']);
});

test('insert/delete/move commands preserve cells, escapes, formula source and outside text', () => {
  for (const action of ['insert-row-above', 'insert-row-below', 'insert-column-left', 'insert-column-right', 'move-column-right']) {
    const { model, rows } = setup(); editTable(model, rows, action);
    assert.ok(model.getText().startsWith('Before\n\n'));
    assert.ok(model.getText().endsWith('\n\nAfter'));
    assert.ok(model.getText().includes('a\\|b')); assert.ok(model.getText().includes('`x|y`'));
    assert.ok(model.getText().includes('$\\alpha$')); assert.ok(model.getText().includes('$\\frac{1}{2}$'));
    model.undo(); assert.equal(model.getText(), source);
  }
  const { model, rows } = setup();
  editTable(model, rows, 'delete-column');
  assert.ok(!model.getText().includes('a\\|b')); assert.ok(model.getText().includes('$\\alpha$'));
  model.undo(); assert.equal(model.getText(), source);
});

test('resize preserves quoted CRLF tables and deleting a table can be undone', () => {
  const text = '> [!note] Test\r\n> | A | B |\r\n> | --- | --- |\r\n> | x | y |\r\n\r\nAfter';
  const { model, rows } = setup(text);
  editTable(model, rows, 'resize', { rows: 4, columns: 3 });
  const next = classifyLines(model.doc), table = next.filter(r => r.type === 'table');
  assert.equal(table.length, 4); assert.ok(table.every(r => r.columns === 3 && r.callouts.length === 1));
  assert.ok(model.getText().includes('> | x | y |  |\r\n'));
  assert.ok(!model.getText().replace(/\r\n/g, '').includes('\n'));
  model.undo(); assert.equal(model.getText(), text);
  editTable(model, rows, 'delete-table');
  assert.equal(model.getText(), '> [!note] Test\r\n\r\nAfter');
  model.undo(); assert.equal(model.getText(), text);
});

test('resize down is undoable, malformed sizes reject without changes, extra cells survive alignment', () => {
  const { model, rows } = setup();
  assert.throws(() => editTable(model, rows, 'resize', { rows: 0, columns: 2 }));
  assert.equal(model.getText(), source);
  editTable(model, rows, 'resize', { rows: 1, columns: 1 });
  assert.equal(classifyLines(model.doc).filter(r => r.type === 'table').length, 1);
  model.undo(); assert.equal(model.getText(), source);
  const over = setup('| A | B |\n| --- | --- |\n| x | y | extra |');
  editTable(over.model, over.rows, 'align', { align: 'center' });
  assert.ok(over.model.getText().includes('| x | y | extra |'));
});

test('moves cannot move a body row above the header and missing cells remain navigable', () => {
  const { model, rows } = setup();
  assert.equal(editTable(model, rows, 'move-row-up'), null);
  editTable(model, rows, 'move-row-down');
  assert.ok(model.getText().indexOf('`x|y`') < model.getText().indexOf('a\\|b'));
  const partial = setup('| A | B |\n| --- | --- |\n| x |');
  assert.equal(partial.rows.filter(r => r.type === 'table').length, 2);
  const context = tableContext(partial.model.doc, partial.rows, partial.model.head);
  const range = cellRange(partial.model.doc, partial.rows, context, 1, 1);
  assert.equal(range.from, range.to);
});

test('table soft breaks render as separate visual lines but remain source text in the active cell', () => {
  const model = new CanvasDocument('| A | B |\n| --- | --- |\n| x<br>y | z |'), rows = classifyLines(model.doc);
  const layout = layoutSourceLine({ font: '' }, model.doc.line(3).text, rows[2], { width: 400, raw: false,
    asset: () => null, measure: (_, text) => text.length * 10 });
  assert.equal(layout.cells[0].layout.lines.length, 2);
  assert.equal(tableCells(model.doc.line(3).text)[0].text, 'x<br>y');
});
