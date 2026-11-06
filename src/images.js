// Standalone fallback follows the Obsidian Images module's documented syntax.
// Inside Typora the installed module supplies parsing and vault resolution.
export function parseWikiImage(text) {
  const match = /^!\[\[([^\]\r\n]+)\]\]/.exec(text);
  if (!match) return null;
  const [file, ...options] = match[1].split('|').map(s => s.trim());
  if (!/\.(png|svg|jpe?g|gif|webp|bmp|avif)$/i.test(file)) return null;
  let align = 'C', width = null, aligned = false;
  for (const option of options) {
    if (/^[CLR]$/i.test(option) && !aligned) { align = option.toUpperCase(); aligned = true; }
    else if (/^\d+$/.test(option) && !width && Number.isSafeInteger(Number(option)) && Number(option) > 0) width = Number(option);
    else return null;
  }
  return { raw: match[0], inner: match[1], file, align, width };
}
export function parseImageSource(text, parseCustom = parseWikiImage) {
  const value = text.trim(), wiki = parseCustom && parseCustom(value);
  if (wiki?.raw === value) return { url: wiki.file, alt: wiki.file, image: { ...wiki, obsidian: true } };
  const standard = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s]+?))(?:\s+"([^"]*)")?\)$/.exec(value);
  return standard ? { alt: standard[1], url: standard[2] || standard[3], image: { alt: standard[1], title: standard[4] || '' } } : null;
}
const allowedImage = url => /^(?:https?:|data:image\/|blob:|file:|typora:)/i.test(url);

export function createImageAdapter({ plugin, write, fs, path, toFileURL, resolveLocal, nativeResolve }) {
  const enabled = plugin && plugin.config?.ENABLE !== false;
  let local = null;
  if (enabled) {
    // A separate resolver keeps vault indexing away from the live document's
    // refresh callback. Await its existing index implementation before decode.
    local = new plugin.constructor(plugin.fixedName, plugin.config, plugin.i18n);
    local.utils = plugin.utils; local.fs = fs; local.path = path;
    const index = local.index;
    local.index = (root, entry) => entry.task = Promise.resolve(index.call(local, root, entry));
    local.refresh = () => {};
  }
  const parseWiki = enabled ? text => local.parse(text) : () => null;
  const resolve = async (source, spec = {}) => {
    if (allowedImage(source)) return source;
    let target;
    if (spec.obsidian && local) {
      target = local.resolve(source);
      const entry = local.roots.get(local.getRoot());
      if (entry?.task && !entry.done) { await entry.task; target = local.resolve(source); }
    } else target = nativeResolve?.(source);
    if (target && allowedImage(target)) return target;
    // Preserve valid literal '%' filenames when URI decoding is impossible.
    let decoded = source; try { decoded = decodeURI(source); } catch {}
    if (!target || !path.isAbsolute(target)) target = resolveLocal(decoded);
    return toFileURL(target);
  };
  const decorate = (img, spec = {}) => {
    if (!spec.obsidian || !local) return img;
    img.title = local.marker + encodeURIComponent(JSON.stringify({ align: spec.align, width: spec.width }));
    const template = write.ownerDocument.createElement('template');
    template.innerHTML = local.decorateImages(img.outerHTML);
    return template.content.querySelector('img');
  };
  return { parse: text => parseImageSource(text, parseWiki), parseWiki, resolve, decorate,
    measure(image, spec, width) {
      const doc = write.ownerDocument, stage = write.cloneNode(false);
      stage.removeAttribute('style'); stage.removeAttribute('contenteditable'); stage.dataset.typoraCanvasImageProbe = '';
      const styles = { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, minWidth: '0', maxWidth: 'none',
        height: 'auto', minHeight: '0', maxHeight: 'none', margin: '0', padding: '0', display: 'flow-root',
        visibility: 'hidden', pointerEvents: 'none', contain: 'layout style', transform: 'none' };
      for (const [key, value] of Object.entries(styles)) stage.style.setProperty(key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), value, 'important');
      const rootStyle = getComputedStyle(write);
      Object.assign(stage.style, { fontFamily: rootStyle.fontFamily, fontSize: rootStyle.fontSize,
        lineHeight: rootStyle.lineHeight, color: rootStyle.color });
      for (const property of rootStyle) if (property.startsWith('--')) stage.style.setProperty(property, rootStyle.getPropertyValue(property));
      let img = image.cloneNode(false);
      // Intrinsic dimensions are available synchronously even before a cloned
      // image's load event; theme CSS and plugin inline CSS can override them.
      img.width = image.naturalWidth;
      img.alt = spec?.alt || ''; if (spec?.title) img.title = spec.title;
      img = decorate(img, spec);
      const p = doc.createElement('p'), wrapper = doc.createElement('span'); wrapper.className = 'md-image';
      wrapper.append(img); p.append(wrapper); stage.append(p); doc.body.append(stage);
      try {
        const outer = stage.getBoundingClientRect(), bounds = img.getBoundingClientRect();
        return { mediaWidth: bounds.width, mediaHeight: bounds.height, mediaX: bounds.left - outer.left,
          top: bounds.top - outer.top, height: outer.height };
      } finally { stage.remove(); }
    } };
}
