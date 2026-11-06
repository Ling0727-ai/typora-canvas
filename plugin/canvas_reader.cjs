/* global BasePlugin */
// Adapter for obgnail/typora_plugin. Editable Canvas uses an explicit save bridge.
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
    hub.on(hub.eventType.fileContentLoaded, () => {
      this.canvasBridge?.checkExternal(); this.contentReady();
    });
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
    const reader = this.reader; this.reader = null;
    // Native DOM must be visible again before its single deferred parse on exit.
    if (this.previousWriteDisplay !== undefined && this.rendererWrite) {
      this.rendererWrite.style.display = this.previousWriteDisplay;
      this.previousWriteDisplay = undefined;
    }
    this.navigationBridge?.detach(); this.navigationBridge = null;
    this.canvasBridge?.detach(); this.canvasBridge = null;
    reader.destroy();
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
      if (automatic && mode !== 'canvas-editor' && !markdown.trim()) return;
      const { mountReader } = runtime;
      this.previousFocus = document.activeElement;
      this.previousStyle = { visibility: this.content.style.visibility, overflow: this.content.style.overflow,
        position: this.content.style.position };
      this.previousScrollTop = this.content.scrollTop;
      // Mount in Typora's existing content pane, preserving its sidebar and shell.
      if (getComputedStyle(this.content).position === 'static') this.content.style.position = 'relative';
      this.content.style.overflow = 'hidden';
      this.content.scrollTop = 0;
      if (mode === 'canvas-editor') {
        const calloutPlugin = this.utils.getPlugin?.('callouts');
        const nativeCallouts = calloutPlugin?.config?.ENABLE !== false
          ? runtime.createNativeCalloutRenderer({ write: this.rendererWrite, plugin: calloutPlugin }) : null;
        const getTheme = () => runtime.readCanvasTheme({ write: this.rendererWrite, content: this.content,
          calloutConfig: this.utils.getPlugin?.('callouts')?.config || { ENABLE: false } });
        this.reader = runtime.mountCanvasEditor({ markdown, parent: this.content, embedded: true, onClose: this.close,
          initialDirty: typeof File.isDocumentEdited === 'function' ? File.isDocumentEdited() : !!File.needSaveState,
          onChange: () => { this.canvasBridge?.changed(); this.navigationBridge?.refresh(); }, onSave: () => this.canvasBridge.save(),
          onViewportChange: () => this.navigationBridge?.highlight(),
          onOpenLink: href => this.navigationBridge?.open(href),
          resolveImage: source => {
            if (/^(?:https?:|data:|blob:|file:)/i.test(source)) return source;
            return require('url').pathToFileURL(this.utils.resolveLocalPath(decodeURI(source))).href;
          }, theme: getTheme(), getTheme, themeNodes: [this.rendererWrite, this.content], nativeCallouts });
        this.canvasBridge = runtime.attachCanvasHost({ file: File, editor: this.reader,
          onConflict: message => this.reader?.setStatus(message), onRecovery: source => {
          const fs = require('fs'), path = require('path');
          const folder = path.join(require('os').homedir(), '.config', 'typora-canvas', 'recovery');
          const filename = require('crypto').createHash('sha256').update(this.documentPath || 'untitled').digest('hex') + '.json';
          try {
            fs.mkdirSync(folder, { recursive: true });
            const target = path.join(folder, filename);
            fs.writeFileSync(target + '.tmp', JSON.stringify({ file: this.documentPath, updatedAt: new Date().toISOString(), markdown: source }));
            fs.renameSync(target + '.tmp', target);
          } catch (error) { console.error('[Typora Canvas] recovery failed', error); }
        } });
        this.navigationBridge = runtime.attachCanvasNavigation({ editor: this.reader, outline: File.editor.library?.outline,
          openLink: href => this.utils.openUrl(href) });
        this.previousWriteDisplay = this.rendererWrite.style.display;
        this.rendererWrite.style.display = 'none';
        console.info('[Typora Canvas] pure Canvas editor active; original Markdown preserved');
      } else {
        this.reader = mountReader({ markdown, title: this.utils.getFilePath().split(/[\\/]/).pop() || '未命名',
          onClose: this.close, parent: this.content, embedded: true });
      }
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
