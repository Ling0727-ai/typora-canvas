import { Text } from '@codemirror/state';
import { calloutContexts } from './callouts.js';

// Immutable rope snapshots preserve Markdown verbatim, including unknown syntax
// and existing CRLF. No rich-text-to-Markdown serialization is involved.
export class CanvasDocument {
  constructor(source = '', { dirty = false } = {}) {
    this.doc = Text.of(source.split('\n'));
    this.saved = dirty ? null : this.doc;
    this.anchor = this.head = 0;
    this.undoStack = []; this.redoStack = []; this.group = null; this.revision = 0;
  }
  get length() { return this.doc.length; }
  get dirty() { return this.doc !== this.saved; }
  get selection() { return { anchor: this.anchor, head: this.head }; }
  get from() { return Math.min(this.anchor, this.head); }
  get to() { return Math.max(this.anchor, this.head); }
  getText() { return this.doc.toString(); }
  select(anchor, head = anchor) {
    this.anchor = Math.max(0, Math.min(this.length, anchor));
    this.head = Math.max(0, Math.min(this.length, head));
  }
  beginGroup() { if (!this.group) this.group = { doc: this.doc, selection: this.selection }; }
  endGroup() {
    const start = this.group; this.group = null;
    if (start && start.doc !== this.doc) this.record(start.doc, start.selection);
  }
  record(before, selection) {
    this.undoStack.push({ before, after: this.doc, selection, afterSelection: this.selection });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  replace(from, to, text, selection = null) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > this.length) throw new RangeError('Invalid edit range');
    const before = this.doc, previous = this.selection;
    const first = before.lineAt(from).number - 1, last = before.lineAt(to).number - 1;
    const deleted = before.sliceString(from, to);
    this.doc = before.replace(from, to, Text.of(text.split('\n')));
    if (selection) this.select(selection.anchor, selection.head); else this.select(from + text.length);
    if (before !== this.doc && !this.group) this.record(before, previous);
    this.revision++;
    return { first, last, addedLines: text.split('\n').length - 1, deleted, inserted: text };
  }
  replaceSelection(text) { return this.replace(this.from, this.to, text); }
  undo() {
    this.endGroup(); const entry = this.undoStack.pop(); if (!entry) return false;
    this.redoStack.push(entry); this.doc = entry.before;
    this.select(entry.selection.anchor, entry.selection.head); this.revision++; return true;
  }
  redo() {
    const entry = this.redoStack.pop(); if (!entry) return false;
    this.undoStack.push(entry); this.doc = entry.after;
    this.select(entry.afterSelection.anchor, entry.afterSelection.head); this.revision++; return true;
  }
  markSaved(snapshot = this.doc) { this.saved = snapshot; }
}

// Minimal replacement between input snapshots, so an IME composition does not
// reinsert an entire document or require a full-document hidden textarea.
export function inputDiff(before, after) {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { from, to: oldEnd, text: after.slice(from, newEnd) };
}

export function classifyLines(doc, { customCallouts = true } = {}) {
  const { contexts, groups } = calloutContexts(doc, { customEnabled: customCallouts });
  const texts = contexts.map(c => c.content);
  const rows = [];
  let fence = null, mathStart = -1, fenceGroup = null, mathGroup = null;
  for (let n = 1; n <= doc.lines; n++) {
    const text = texts[n - 1];
    const path = contexts[n - 1].callouts;
    if (fenceGroup && !path.some(group => group.id === fenceGroup)) { fence = null; fenceGroup = null; }
    if (mathGroup && !path.some(group => group.id === mathGroup)) { mathStart = -1; mathGroup = null; }
    const row = { type: 'paragraph', level: 0, revision: 0 };
    const marker = /^\s*(`{3,}|~{3,})/.exec(text);
    if (contexts[n - 1].calloutHeader) row.type = 'callout-title';
    else if (fence) {
      row.type = 'code';
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    } else if (marker) { fence = marker[1]; fenceGroup = path.at(-1)?.id || null; row.type = 'code'; }
    else if (/^\s*\$\$\s*$/.test(text)) {
      if (mathStart < 0) { mathStart = n - 1; mathGroup = path.at(-1)?.id || null; row.type = 'math'; }
      else {
        const tex = texts.slice(mathStart + 1, n - 1).join('\n').trim();
        rows[mathStart] = { ...rows[mathStart], type: 'math', tex, end: n - 1, revision: 0 };
        for (let i = mathStart + 1; i < n - 1; i++) rows[i] = { ...rows[i], type: 'math-tail', start: mathStart, end: n - 1, revision: 0 };
        row.type = 'math-tail'; row.start = mathStart; row.end = n - 1; mathStart = -1;
      }
    } else if (mathStart >= 0) row.type = 'paragraph';
    else {
      const formula = /^\s*\$\$(.+)\$\$\s*$/.exec(text);
      const image = /^\s*!\[([^\]]*)\]\(([^\s]+?)(?:\s+"[^"]*")?\)\s*$/.exec(text);
      const heading = /^(#{1,6})\s/.exec(text);
      if (formula) Object.assign(row, { type: 'math', tex: formula[1], end: n - 1 });
      else if (image) Object.assign(row, { type: 'image', alt: image[1], url: image[2] });
      else if (heading) Object.assign(row, { type: 'heading', level: heading[1].length });
      else if (/^\s*>/.test(text)) row.type = 'quote';
    }
    rows.push({ ...row, ...contexts[n - 1] });
  }
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].type !== 'paragraph' || rows[i + 1].type !== 'paragraph') continue;
    if (rows[i].callouts.at(-1)?.id !== rows[i + 1].callouts.at(-1)?.id) continue;
    const header = tableCells(texts[i]), separator = tableCells(texts[i + 1]);
    if (!header.length || header.length !== separator.length || !separator.every(c => /^:?-{3,}:?$/.test(c.text))) continue;
    const alignments = separator.map(c => c.text.startsWith(':') && c.text.endsWith(':') ? 'center' : c.text.endsWith(':') ? 'right' : 'left');
    rows[i] = { ...rows[i], type: 'table', columns: header.length, header: true, alignments, revision: 0 };
    rows[i + 1] = { ...rows[i + 1], type: 'table-separator', revision: 0 };
    let end = i + 2;
    while (end < rows.length && rows[end].type === 'paragraph' &&
        rows[end].callouts.at(-1)?.id === rows[i].callouts.at(-1)?.id && tableCells(texts[end]).length > 0) {
      rows[end] = { ...rows[end], type: 'table', columns: header.length, alignments, revision: 0 }; end++;
    }
    for (let j = i; j < end; j++) Object.assign(rows[j], { tableStart: i, tableEnd: end - 1, tableRow: j === i ? 0 : j === i + 1 ? -1 : j - i - 1 });
    i = end - 1;
  }
  rows.calloutGroups = groups;
  return rows;
}

export function tableCells(text) {
  const separators = [];
  let escaped = false, code = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '`') code = !code;
    if (char === '|' && !code) separators.push(i);
  }
  if (!separators.length) return [];
  let start = 0, end = text.length;
  if (text.slice(0, separators[0]).trim() === '') start = separators.shift() + 1;
  if (separators.length && text.slice(separators.at(-1) + 1).trim() === '') end = separators.pop();
  const bounds = [start - 1, ...separators, end];
  return bounds.slice(1).map((to, i) => {
    const rawFrom = bounds[i] + 1, raw = text.slice(rawFrom, to);
    const from = rawFrom + (raw.length - raw.trimStart().length);
    return { from, to: from + raw.trim().length, text: raw.trim() };
  });
}
