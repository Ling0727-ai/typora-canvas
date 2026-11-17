import { parseImageSource } from './images.js';
import { frontMatterEnd } from './front-matter.js';

export function classifyBlocks(contexts, { parseImage = parseImageSource } = {}) {
  const rows = [], codes = [];
  const metadataEnd = frontMatterEnd(contexts.map(context => context.content));
  let code = null, math = null;
  const sameScope = (block, context) => (!block.group || context.callouts.some(g => g.id === block.group)) &&
    (block.listItem === undefined || context.listScopes?.includes(block.listItem));
  function finishCode(end) {
    code.end = end;
    for (let i = code.start; i <= end; i++) Object.assign(rows[i], { codeStart: code.start, codeEnd: end, language: code.language });
    codes.push(code); code = null;
  }
  for (let i = 0; i < contexts.length; i++) {
    const context = contexts[i], text = context.content.replace(/\r$/, '');
    // Typora treats a leading YAML front matter block as document metadata,
    // not as a horizontal rule followed by Markdown. Keep the source lines
    // intact while giving the renderer the same code block semantics used for
    // fenced YAML, including language highlighting and theme styling.
    const frontMatterOpen = i === 0 && metadataEnd > 0;
    if (!code && frontMatterOpen) {
      const languageFrom = context.sourceOffset + text.indexOf('---') + 3;
      code = { start: i, end: i, marker: '---', language: 'yaml', languageFrom,
        group: context.callouts.at(-1)?.id, listItem: context.listScopes?.at(-1), frontMatter: true };
      rows.push({ type: 'code-fence', level: 0, revision: 0, ...context,
        codeHeader: true, codeStart: i, language: 'yaml', languageFrom, frontMatter: true });
      continue;
    }
    if (code?.frontMatter) {
      const row = { type: 'code', level: 0, revision: 0, ...context, codeStart: code.start, language: 'yaml', frontMatter: true };
      if (i === metadataEnd) {
        Object.assign(row, { type: 'code-fence', codeFooter: true });
        rows.push(row); finishCode(i); continue;
      }
      rows.push(row); continue;
    }
    if (code && !sameScope(code, context)) finishCode(i - 1);
    if (math && !sameScope(math, context)) math = null;
    const row = { type: 'paragraph', level: 0, revision: 0, ...context };
    const fence = /^(\s*)(`{3,}|~{3,})([^\r]*)$/.exec(text);
    if (code) {
      row.type = 'code'; row.codeStart = code.start; row.language = code.language;
      if (fence && fence[2][0] === code.marker[0] && fence[2].length >= code.marker.length && !fence[3].trim()) {
        row.type = 'code-fence'; row.codeFooter = true; rows.push(row); finishCode(i); continue;
      }
    } else if (fence) {
      const info = fence[3].trim(), language = info.split(/\s/, 1)[0];
      const languageFrom = context.sourceOffset + fence[1].length + fence[2].length + (fence[3].length - fence[3].trimStart().length);
      code = { start: i, end: i, marker: fence[2], language, languageFrom, group: context.callouts.at(-1)?.id, listItem: context.listScopes?.at(-1) };
      Object.assign(row, { type: 'code-fence', codeHeader: true, codeStart: i, language, languageFrom });
    } else if (math) {
      const close = math.bracket ? /\\\]\s*$/ : /(?<!\\)\$\$\s*$/;
      const ending = close.exec(text);
      math.parts.push(ending ? text.slice(0, ending.index) : text);
      if (ending) {
        Object.assign(rows[math.start], { type: 'math', tex: math.parts.join('\n').trim(), end: i });
        for (let j = math.start + 1; j < i; j++) Object.assign(rows[j], { type: 'math-tail', start: math.start, end: i });
        Object.assign(row, { type: 'math-tail', start: math.start, end: i }); math = null;
      }
    } else if (context.calloutHeader) row.type = 'callout-title';
    else {
      const open = /^\s*(\$\$|\\\[)(.*)$/.exec(text);
      const image = parseImage(text);
      const heading = /^(#{1,6})\s/.exec(text);
      if (open) {
        const bracket = open[1] !== '$$', close = bracket ? /\\\]\s*$/ : /(?<!\\)\$\$\s*$/;
        const ending = close.exec(open[2]);
        if (ending) Object.assign(row, { type: 'math', tex: open[2].slice(0, ending.index).trim(), end: i });
        else { row.type = 'math'; math = { start: i, parts: [open[2]], bracket, group: context.callouts.at(-1)?.id, listItem: context.listScopes?.at(-1) }; }
      } else if (!text.trim()) row.type = 'blank';
      else if (/^\s{0,3}(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/.test(text)) row.type = 'rule';
      else if (image) Object.assign(row, { type: 'image', ...image });
      else if (heading) Object.assign(row, { type: 'heading', level: heading[1].length });
      else if (/^\s*>/.test(text)) row.type = 'quote';
    }
    rows.push(row);
  }
  if (code) finishCode(rows.length - 1);
  rows.codeBlocks = codes;
  return rows;
}
