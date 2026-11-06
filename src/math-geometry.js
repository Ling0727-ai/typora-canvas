// Geometry is based on the finished SVG, not the surrounding text line height.
// Keep the same spacing in direct Canvas layout and native Callout captures.
export function displayMathGeometry(media, width, fontSize = 17) {
  const scale = Math.min(1, Math.max(1, width) / Math.max(1, media.width));
  const gap = Math.ceil(fontSize * .65);
  const mediaWidth = media.width * scale, mediaHeight = media.height * scale;
  return { mediaWidth, mediaHeight, mediaX: Math.max(0, (width - mediaWidth) / 2),
    top: gap, bottom: gap, height: mediaHeight + gap * 2 };
}
