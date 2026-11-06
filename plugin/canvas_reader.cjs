/* global BasePlugin */
// Adapter for obgnail/typora_plugin. No edits or saves to the host document.
class CanvasReaderPlugin extends BasePlugin {
  autoTimer = null;
  pollTimer = null;
  suppressed = false;
  documentPath = null;
  hotkey = () => [{ hotkey: this.config.HOTKEY || 'ctrl+alt+shift+f8', callback: this.call }];
  process = () => {
    const hub = this.utils.eventHub;
    hub.on(hub.eventType.beforeFileOpen, () => {
      clearTimeout(this.autoTimer);
      this.teardown(false);
    });
    hub.on(hub.eventType.beforeToggleSourceMode, () => this.teardown(false));
    // MathJax / initial document rendering also emits fileEdited. Do not treat
    // these events as the user disabling the plugin, or AUTO_OPEN never sticks.
    hub.on(hub.eventType.fileEdited, () => this.reader?.invalidate?.());
    hub.on(hub.eventType.fileContentLoaded, this.contentReady);
    hub.on(hub.eventType.allPluginsHadInjected, this.contentReady);
    // Fallback for host versions where fileContentLoaded is missed on startup.
    // It only checks readiness / source mode; it never parses or redraws text.
    this.pollTimer = setInterval(this.contentReady, 1000);
    this.contentReady();
  };
  contentReady = () => {
    const path = this.utils.getFilePath();
    if (path !== this.documentPath) {
      this.documentPath = path;
      this.suppressed = false;
    }
    if (typeof File !== 'undefined' && File.editor?.sourceView?.inSourceMode) {
      clearTimeout(this.autoTimer); this.teardown(false); return;
    }
    if (this.reader && this.rendererWrite !== this.utils.entities.eWrite) this.teardown(false);
    if (this.config.AUTO_OPEN === false || this.suppressed || this.reader) return;
    clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      if (this.suppressed || this.reader) return;
      if (typeof File !== 'undefined' && File.editor?.sourceView?.inSourceMode) return;
      // Empty new files stay editable. Read only after Typora reports readiness.
      this.open(true);
    }, 120);
  };
  close = () => {
    this.suppressed = true;
    clearTimeout(this.autoTimer);
    this.teardown();
  };
  teardown = (restoreFocus = true) => {
    if (!this.reader) return;
    this.reader.destroy(); this.reader = null;
    if (this.previousStyle) {
      Object.assign(this.content.style, this.previousStyle);
      this.content.scrollTop = this.previousScrollTop;
      if (restoreFocus && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
      this.previousStyle = null;
    }
  };
  call = () => {
    if (this.reader) { this.close(); return; }
    clearTimeout(this.autoTimer);
    this.suppressed = false;
    this.open();
  };
  open = (automatic = false) => {
    try {
      const mode = this.config.RENDER_MODE || 'hybrid';
      this.content = this.utils.entities.eContent;
      this.rendererWrite = this.utils.entities.eWrite;
      if (!this.content || !this.rendererWrite) return;
      const runtime = require('./canvas_reader/runtime.cjs');
      if (mode === 'hybrid') {
        this.reader = runtime.mountHybrid({ content: this.content, write: this.rendererWrite,
          cacheBytes: (this.config.CACHE_MB || 24) * 1024 * 1024 });
        console.info('[Typora Canvas] hybrid renderer active; native editing and regex search retained');
        return;
      }
      const markdown = this.utils.getCurrentFileContent();
      if (typeof markdown !== 'string') throw new Error('Typora did not return Markdown text');
      if (automatic && !markdown.trim()) return;
      const { mountReader } = runtime;
      this.previousFocus = document.activeElement;
      this.previousStyle = { visibility: this.content.style.visibility, overflow: this.content.style.overflow,
        position: this.content.style.position };
      this.previousScrollTop = this.content.scrollTop;
      // Mount in Typora's existing content pane, preserving its sidebar and shell.
      if (getComputedStyle(this.content).position === 'static') this.content.style.position = 'relative';
      this.content.style.overflow = 'hidden';
      this.content.scrollTop = 0;
      this.reader = mountReader({ markdown, title: this.utils.getFilePath().split(/[\\/]/).pop() || '未命名',
        onClose: this.close, parent: this.content, embedded: true });
      this.content.style.visibility = 'hidden';
    } catch (error) {
      this.close(); console.error('[Typora Canvas]', error);
      // mountReader can fail before returning a reader, after pane preparation.
      if (this.content && this.previousStyle) {
        Object.assign(this.content.style, this.previousStyle);
        this.content.scrollTop = this.previousScrollTop;
      }
      this.utils.showMessageBox({ type: 'error', message: 'Typora Canvas 启动失败', detail: String(error), buttons: ['确定'] });
    }
  };
  dispose = () => {
    clearInterval(this.pollTimer); clearTimeout(this.autoTimer); this.teardown(false);
  };
}
module.exports = { plugin: CanvasReaderPlugin };
