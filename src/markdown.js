import MarkdownIt from 'markdown-it';

// Never run raw HTML, fetch resources, or evaluate fenced code from a document.
const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
const MAX_RUN = 2048;

function inlineRuns(tokens = []) {
  const runs = [];
  let bold = 0, italic = 0, strike = 0, link = 0;
  for (const token of tokens) {
    if (token.type === 'strong_open') bold++;
    else if (token.type === 'strong_close') bold--;
    else if (token.type === 'em_open') italic++;
    else if (token.type === 'em_close') italic--;
    else if (token.type === 's_open') strike++;
    else if (token.type === 's_close') strike--;
    else if (token.type === 'link_open') link++;
    else if (token.type === 'link_close') link--;
    else {
      const text = token.type === 'image'
        ? `[图片：${token.content || token.attrGet('src') || '未命名'}]`
        : ['softbreak', 'hardbreak'].includes(token.type) ? '\n' : token.content;
      if (text) runs.push({ text, bold: !!bold, italic: !!italic, strike: !!strike,
        link: !!link, code: token.type === 'code_inline' });
    }
  }
  return runs;
}

// Split pathological single paragraphs/fences so one viewport cannot trigger
// layout of megabytes. Continuations retain styles and source-line provenance.
function appendBounded(blocks, block) {
  let runs = [], length = 0, continuation = false;
  const flush = () => {
    if (!runs.length) return;
    blocks.push({ ...block, runs, continuation, text: runs.map(r => r.text).join('') });
    runs = []; length = 0; continuation = true;
  };
  for (const run of block.runs) {
    const chars = Array.from(run.text);
    for (let start = 0; start < chars.length;) {
      const take = Math.min(MAX_RUN - length, chars.length - start);
      runs.push({ ...run, text: chars.slice(start, start + take).join('') });
      start += take; length += take;
      if (length >= MAX_RUN) flush();
    }
  }
  flush();
}

export function parseMarkdown(markdown) {
  const tokens = parser.parse(markdown, {});
  const blocks = [];
  const lists = [];
  let quote = 0, itemPrefix = '', heading = 0, inTable = false, tableHeader = false;
  let row = null;
  for (const token of tokens) {
    const line = token.map?.[0] ?? 0;
    if (token.type === 'blockquote_open') quote++;
    else if (token.type === 'blockquote_close') quote--;
    else if (token.type === 'bullet_list_open') lists.push({ ordered: false });
    else if (token.type === 'ordered_list_open') lists.push({ ordered: true, next: Number(token.attrGet('start') || 1) });
    else if (token.type.endsWith('_list_close')) lists.pop();
    else if (token.type === 'list_item_open') {
      const list = lists.at(-1);
      itemPrefix = list?.ordered ? `${list.next++}. ` : '• ';
    } else if (token.type === 'list_item_close') itemPrefix = '';
    else if (token.type === 'heading_open') heading = Number(token.tag.slice(1));
    else if (token.type === 'heading_close') heading = 0;
    else if (token.type === 'table_open') inTable = true;
    else if (token.type === 'table_close') inTable = false;
    else if (token.type === 'thead_open') tableHeader = true;
    else if (token.type === 'thead_close') tableHeader = false;
    else if (token.type === 'tr_open') row = { type: 'table', cells: [], header: tableHeader, line, quote, indent: lists.length };
    else if (token.type === 'tr_close' && row) {
      row.text = row.cells.map(c => c.map(r => r.text).join('')).join(' | ');
      blocks.push(row); row = null;
    } else if (token.type === 'inline') {
      const runs = inlineRuns(token.children);
      if (inTable && row) row.cells.push(runs);
      else {
        if (itemPrefix) runs.unshift({ text: itemPrefix });
        appendBounded(blocks, { type: heading ? 'heading' : 'paragraph', level: heading,
          quote, indent: lists.length, line, runs });
        itemPrefix = '';
      }
    } else if (token.type === 'fence' || token.type === 'code_block') {
      appendBounded(blocks, { type: 'code', info: token.info, quote, indent: lists.length,
        line, runs: [{ text: token.content.replace(/\n$/, ''), code: true }] });
    } else if (token.type === 'hr') blocks.push({ type: 'rule', text: '', line, quote, indent: 0 });
  }
  return blocks;
}
