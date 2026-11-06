// Keep the independent source model authoritative while Canvas is mounted.
// Typora 1.14's sync() and getMarkdown() are the save/recovery entry points.
// No native reload/parse is performed per keystroke. One reload occurs on exit.
export function attachCanvasHost({ file, editor, onRecovery = () => {}, onConflict = () => {} }) {
  if (!file?.editor || typeof file.sync !== 'function' || typeof file.editor.getMarkdown !== 'function' ||
      typeof file.reloadContent !== 'function') throw new Error('此 Typora 版本缺少 Canvas 保存桥接接口');
  const nativeEditor = file.editor, originalSync = file.sync, originalMarkdown = nativeEditor.getMarkdown;
  const initial = editor.getText();
  let attached = true, recoveryTimer, conflict = false, savedSource = null;
  let nativeSource = originalMarkdown.call(nativeEditor);
  const checkExternal = () => {
    const actual = originalMarkdown.call(nativeEditor), current = editor.getText();
    if (actual === nativeSource || actual === current || (savedSource !== null && file.bundle?.savedContent === savedSource)) {
      nativeSource = actual; return false;
    }
    conflict = true; onRecovery(current); onConflict('检测到原生文档或外部文件更新：已保留 Canvas 恢复副本，暂停写回以避免覆盖。');
    return true;
  };
  const getMarkdown = () => editor.getText();
  const sync = (update, quiet, skipSetContent) => {
    const source = editor.getText();
    if (!skipSetContent && typeof file.setContent === 'function') {
      Promise.resolve(file.setContent(source, quiet)).catch(error => console.error('[Typora Canvas] setContent failed', error));
    }
    return source;
  };
  nativeEditor.getMarkdown = getMarkdown; file.sync = sync;
  return {
    checkExternal,
    changed() {
      if (!attached) return;
      if (typeof file.updateChangeCount === 'function') file.updateChangeCount(file.ChangeType?.NSChangeDone);
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => { if (attached) onRecovery(editor.getText()); }, 500);
    },
    async save() {
      if (!attached) throw new Error('保存桥接已卸载');
      if (conflict || checkExternal()) throw new Error('外部文档已变化，请先处理恢复副本');
      if (typeof file.saveUseNode !== 'function') throw new Error('此 Typora 版本不支持已验证的保存接口');
      const snapshot = editor.getText();
      const result = await file.saveUseNode();
      if (result === false) throw new Error('Typora 未完成保存');
      savedSource = snapshot;
    },
    detach() {
      if (!attached) return;
      const source = editor.getText(); attached = false; clearTimeout(recoveryTimer);
      if (file.sync === sync) file.sync = originalSync;
      if (nativeEditor.getMarkdown === getMarkdown) nativeEditor.getMarkdown = originalMarkdown;
      if (source !== initial) {
        onRecovery(source);
        // Restore the native document before the original file-switch / close
        // operation continues, so its unsaved-change handling sees current text.
        if (!conflict) file.reloadContent(source, { fromDiskChange: false, skipChangeCount: savedSource === source });
      }
    }
  };
}
