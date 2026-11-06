/* global BasePlugin */
// Adapter for obgnail/typora_plugin. No edits or saves to the host document.
class CanvasReaderPlugin extends BasePlugin {
  autoTimer = null;
  suppressed = false;
  documentPath = null;
  hotkey = () => [{ hotkey: this.config.HOTKEY || 'ctrl+alt+shift+f8', callback: this.call }];
  process = () => {
    const hub = this.utils.eventHub;
    hub.on(hub.eventType.beforeFileOpen, () => {
      clearTimeout(this.autoTimer);
      this.teardown(false);
    });
    for (const name of ['beforeToggleSourceMode', 'fileEdited']) {
      hub.on(hub.eventType[name], this.close);
    }
    hub.on(hub.eventType.fileContentLoaded, this.contentReady);
    hub.on(hub.eventType.allPluginsHadInjected, this.contentReady);
  };
  contentReady = () => {
    const path = this.utils.getFilePath();
    if (path !== this.documentPath) {
      this.documentPath = path;
      this.suppressed = false;
    }
    clearTimeout(this.autoTimer);
    if (this.config.AUTO_OPEN === false || this.suppressed || this.reader) return;
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
    Object.assign(this.content.style, this.previousStyle);
    this.content.scrollTop = this.previousScrollTop;
    if (restoreFocus && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  };
  call = () => {
    if (this.reader) { this.close(); return; }
    clearTimeout(this.autoTimer);
    this.suppressed = false;
    this.open();
  };
  open = (automatic = false) => {
    try {
      const markdown = this.utils.getCurrentFileContent();
      if (typeof markdown !== 'string') throw new Error('Typora did not return Markdown text');
      if (automatic && !markdown.trim()) return;
      const { mountReader } = require('./canvas_reader/runtime.cjs');
      this.previousFocus = document.activeElement;
      this.content = this.utils.entities.eContent;
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
}
module.exports = { plugin: CanvasReaderPlugin };
