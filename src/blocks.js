export function classifyBlocks(contexts) {
  const rows = [], codes = [];
  let code = null, math = null;
  const sameScope = (block, context) => !block.group || context.callouts.some(g => g.id === block.group);
  function finishCode(end) {
    code.end = end;
    for (let i = code.start; i <= end; i++) Object.assign(rows[i], { codeStart: code.start, codeEnd: end, language: code.language });
    codes.push(code); code = null;
  }
  for (let i = 0; i < contexts.length; i++) {
    const context = contexts[i], text = context.content.replace(/\r$/, '');
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
      code = { start: i, end: i, marker: fence[2], language, languageFrom, group: context.callouts.at(-1)?.id };
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
      const image = /^\s*!\[([^\]]*)\]\(([^\s]+?)(?:\s+"[^"]*")?\)\s*$/.exec(text);
      const heading = /^(#{1,6})\s/.exec(text);
      if (open) {
        const bracket = open[1] !== '$$', close = bracket ? /\\\]\s*$/ : /(?<!\\)\$\$\s*$/;
        const ending = close.exec(open[2]);
        if (ending) Object.assign(row, { type: 'math', tex: open[2].slice(0, ending.index).trim(), end: i });
        else { row.type = 'math'; math = { start: i, parts: [open[2]], bracket, group: context.callouts.at(-1)?.id }; }
      } else if (!text.trim()) row.type = 'blank';
      else if (/^\s{0,3}(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/.test(text)) row.type = 'rule';
      else if (image) Object.assign(row, { type: 'image', alt: image[1], url: image[2] });
      else if (heading) Object.assign(row, { type: 'heading', level: heading[1].length });
      else if (/^\s*>/.test(text)) row.type = 'quote';
    }
    rows.push(row);
  }
  if (code) finishCode(rows.length - 1);
  rows.codeBlocks = codes;
  return rows;
}
