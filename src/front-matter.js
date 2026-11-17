// A closed metadata block is recognized only at the start of the document.
// Leave an unmatched opening rule to the ordinary Markdown parser.
export function frontMatterEnd(lines) {
  if (!/^\uFEFF?---[\t ]*\r?$/.test(lines[0] || '')) return -1;
  return lines.findIndex((text, i) => i > 0 && /^(?:---|\.\.\.)[\t ]*\r?$/.test(text));
}
