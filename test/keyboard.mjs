// Exercise the host platform's real application shortcuts, including native
// contenteditable undo/copy, rather than assuming Windows/Linux Ctrl on macOS.
export function usePlatformShortcuts(page, platform = process.platform) {
  if (platform !== 'darwin') return;
  for (const method of ['press', 'down', 'up']) {
    const original = page.keyboard[method].bind(page.keyboard);
    page.keyboard[method] = (key, ...args) => original(key.replace(/\bControl\b/g, 'Meta'), ...args);
  }
}
