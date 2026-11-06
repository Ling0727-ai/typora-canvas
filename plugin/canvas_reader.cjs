/* global BasePlugin */
// Adapter for obgnail/typora_plugin. No edits or saves to the host document.
class CanvasReaderPlugin extends BasePlugin {
  hotkey = () => [{ hotkey: this.config.HOTKEY || 'ctrl+alt+shift+f8', callback: this.call }];
  process = () => {
    const hub = this.utils.eventHub;
    for (const name of ['beforeFileOpen', 'beforeToggleSourceMode', 'fileEdited']) {
      hub.on(hub.eventType[name], this.close);
    }
  };
  close = () => {
    if (!this.reader) return;
    this.reader.destroy(); this.reader = null;
    if (this.content) this.content.style.visibility = this.previousVisibility;
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  };
  call = () => {
    if (this.reader) { this.close(); return; }
    try {
      const markdown = this.utils.getCurrentFileContent();
      if (typeof markdown !== 'string') throw new Error('Typora did not return Markdown text');
      const { mountReader } = require('./canvas_reader/runtime.cjs');
      this.previousFocus = document.activeElement;
      this.content = this.utils.entities.eContent;
      this.previousVisibility = this.content.style.visibility;
      this.reader = mountReader({ markdown, title: this.utils.getFilePath().split(/[\\/]/).pop() || '未命名', onClose: this.close });
      this.content.style.visibility = 'hidden';
    } catch (error) {
      this.close(); console.error('[Typora Canvas]', error);
      this.utils.showMessageBox({ type: 'error', message: 'Typora Canvas 启动失败', detail: String(error), buttons: ['确定'] });
    }
  };
}
module.exports = { plugin: CanvasReaderPlugin };
