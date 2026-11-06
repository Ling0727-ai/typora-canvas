import { readCalloutTheme } from './callouts.js';

const transparent = color => !color || color === 'transparent' || /^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\s*\)$/.test(color);
export function readCanvasTheme({ write, content, calloutConfig = {} }) {
  const style = getComputedStyle(write);
  let background;
  for (let el = write; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (!transparent(color)) { background = color; break; }
  }
  if (!background) background = style.getPropertyValue('--bg-color').trim() || '#fafbfd';
  return { color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize, background,
    callouts: readCalloutTheme({ write, config: calloutConfig }) };
}

// Theme CSS often finishes loading after the menu action / href change.
// Observe both shell changes and stylesheet load, without watching editor text.
export function watchCanvasTheme(read, update) {
  let timer, stopped = false, previous = '';
  const refresh = () => {
    if (stopped) return;
    try {
      const next = read(), serialized = JSON.stringify(next);
      if (serialized !== previous) { previous = serialized; update(next); }
    } catch (error) { console.error('[Typora Canvas] theme refresh failed', error); }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 30); };
  const observer = new MutationObserver(records => {
    if (records.some(m => m.target === document.body || m.target === document.documentElement ||
        ['STYLE', 'LINK'].includes(m.target.nodeName) || m.target.parentElement?.tagName === 'STYLE' ||
        [...m.addedNodes, ...m.removedNodes].some(n => ['STYLE', 'LINK'].includes(n.nodeName)))) schedule();
  });
  observer.observe(document.head, { childList: true, subtree: true, attributes: true, characterData: true });
  for (const node of [document.body, document.documentElement]) observer.observe(node, { attributes: true, attributeFilter: ['class', 'style'] });
  const onLoad = event => { if (event.target?.tagName === 'LINK') schedule(); };
  const onFonts = () => { previous = ''; schedule(); };
  document.fonts?.addEventListener('loadingdone', onFonts);
  document.addEventListener('load', onLoad, true); refresh();
  return () => {
    stopped = true; clearTimeout(timer); observer.disconnect(); document.removeEventListener('load', onLoad, true);
    document.fonts?.removeEventListener('loadingdone', onFonts);
  };
}
