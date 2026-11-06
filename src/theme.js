import { readCalloutTheme } from './callouts.js';
import { readNativeStyles, transparent } from './native-theme.js';

export function readCanvasTheme({ write, content, calloutConfig = {} }) {
  const style = getComputedStyle(write);
  let background;
  for (let el = write; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (!transparent(color)) { background = color; break; }
  }
  if (!background) background = style.getPropertyValue('--bg-color').trim() || '#fafbfd';
  return { color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize, background, ...readNativeStyles(write),
    callouts: readCalloutTheme({ write, config: calloutConfig }) };
}

// Theme CSS often finishes loading after the menu action / href change.
// Observe both shell changes and stylesheet load, without watching editor text.
export function watchCanvasTheme(read, update, { nodes = [] } = {}) {
  let timers = [], stopped = false, previous = '';
  const watched = new Set([document.body, document.documentElement, ...nodes]);
  const transitioning = () => document.getAnimations?.().some(animation => {
    const property = animation.transitionProperty || '';
    return watched.has(animation.effect?.target) && /color|background|font|line-height|all/.test(property) && animation.playState === 'running';
  });
  const refresh = () => {
    if (stopped) return;
    if (transitioning()) return;
    try {
      const next = read(), serialized = JSON.stringify(next);
      if (serialized !== previous) { previous = serialized; update(next); }
    } catch (error) { console.error('[Typora Canvas] theme refresh failed', error); }
  };
  // A single theme switch may load several sheets and animate its background.
  // Re-sample a bounded settling window; old switch timers are cancelled.
  const schedule = () => {
    timers.forEach(clearTimeout);
    timers = [30, 100, 250, 500, 900, 1600].map(delay => setTimeout(refresh, delay));
  };
  const observer = new MutationObserver(records => {
    if (records.some(m => watched.has(m.target) ||
        ['STYLE', 'LINK'].includes(m.target.nodeName) || m.target.parentElement?.tagName === 'STYLE' ||
        [...m.addedNodes, ...m.removedNodes].some(n => ['STYLE', 'LINK'].includes(n.nodeName)))) schedule();
  });
  observer.observe(document.head, { childList: true, subtree: true, attributes: true, characterData: true });
  for (const node of watched) observer.observe(node, { attributes: true, attributeFilter: ['class', 'style'] });
  const onLoad = event => { if (event.target?.tagName === 'LINK') schedule(); };
  const onFonts = () => { previous = ''; schedule(); };
  document.fonts?.addEventListener('loadingdone', onFonts);
  document.addEventListener('load', onLoad, true); refresh();
  const onTransition = event => { if (watched.has(event.target)) schedule(); };
  document.addEventListener('transitionend', onTransition, true); document.addEventListener('transitioncancel', onTransition, true);
  return () => {
    stopped = true; timers.forEach(clearTimeout); observer.disconnect(); document.removeEventListener('load', onLoad, true);
    document.removeEventListener('transitionend', onTransition, true); document.removeEventListener('transitioncancel', onTransition, true);
    document.fonts?.removeEventListener('loadingdone', onFonts);
  };
}
