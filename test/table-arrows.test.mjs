import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasDocument, classifyLines } from '../src/editor-model.js';
import { cellRange, tableContext, tableArrowTarget } from '../src/table-commands.js';

test('table arrows cross cell boundaries and skip the Markdown separator row', () => {
  for (const prefix of ['', '> ']) {
    const source = (prefix ? '> [!note] Table\r\n' : '') + ['| Head | Other |', '| --- | --- |', '| abc | de |', '| f | gh |'].map(s => prefix + s).join('\r\n');
    const model = new CanvasDocument(source), rows = classifyLines(model.doc);
    const context = tableContext(model.doc, rows, source.indexOf('Head'));
    const range = (r, c) => cellRange(model.doc, rows, context, r, c);
    const target = (r, c, offset, key) => { const at = range(r, c).from + offset; return tableArrowTarget(model.doc, rows, at, at, key); };
    assert.equal(target(0, 0, 1, 'ArrowDown').position, range(1, 0).from + 1);
    assert.equal(target(1, 1, 1, 'ArrowUp').position, range(0, 1).from + 1);
    assert.equal(target(1, 0, 0, 'ArrowLeft').position, range(0, 1).to);
    assert.equal(target(1, 1, 2, 'ArrowRight').position, range(2, 0).from);
    assert.equal(target(1, 0, 1, 'ArrowRight'), null, 'normal text movement inside a cell');
    assert.equal(target(1, 0, 2, 'ArrowDown').position, range(2, 0).to, 'short target clamps offset');
    assert.equal(target(0, 0, 0, 'ArrowLeft').exit, -1);
    assert.equal(target(0, 1, 0, 'ArrowUp').exit, -1);
    assert.equal(target(2, 1, 2, 'ArrowRight').exit, 1);
    assert.equal(target(2, 0, 0, 'ArrowDown').exit, 1);
  }
});
