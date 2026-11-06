export const TABLE_TOOLS_HEIGHT = 36;
const icon = paths => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export function mountTableToolbar(main, { action, focusEditor }) {
  const host = document.createElement('div'); host.className = 'table-ui'; host.hidden = true;
  const button = (name, key, svg) => `<button type="button" aria-label="${name}" title="${name}" data-command="${key}">${svg}</button>`;
  const menuItems = [
    ['insert-row-above', '在上方插入行'], ['insert-row-below', '在下方插入行'], ['delete-row', '删除当前行'],
    ['insert-column-left', '在左侧插入列'], ['insert-column-right', '在右侧插入列'], ['delete-column', '删除当前列'],
    ['move-row-up', '向上移动行'], ['move-row-down', '向下移动行'], ['move-column-left', '向左移动列'], ['move-column-right', '向右移动列'],
    ['copy', '复制表格'], ['format', '格式化表格源码']
  ];
  host.innerHTML = `<style>
    .table-ui{position:absolute;inset:0;pointer-events:none;z-index:4}.table-ui[hidden],.table-ui [hidden]{display:none!important}
    .table-tools{position:absolute;height:30px;display:flex;align-items:center;gap:3px;background:var(--tc-bg,#fff);border:1px solid #8997b355;border-radius:4px;padding:1px 3px;pointer-events:auto;overflow-x:auto}
    .table-tools button{display:flex;align-items:center;justify-content:center;flex:none;width:27px;height:25px;padding:2px;border:0;background:transparent;color:inherit;border-radius:3px}
    .table-tools button:hover,.table-menu button:hover{background:#4c80d122}.table-tools button[aria-pressed=true]{background:#4c80d133;color:var(--tc-color,#243044)}
    .table-tools .table-size{flex:1;min-width:20px;font-size:11px;white-space:nowrap;text-align:right;opacity:.7;padding:0 7px}
    .table-popup{position:absolute;pointer-events:auto;background:var(--tc-bg,#fff);border:1px solid #8997b377;box-shadow:0 5px 20px #0002;border-radius:5px;padding:10px;max-width:calc(100% - 16px);overflow:auto}
    .table-resize{width:250px}.table-resize label{display:flex;align-items:center;gap:8px;margin-bottom:8px}.table-resize input{width:80px;min-width:40px;flex:1}
    .table-resize .form-actions{display:flex;justify-content:flex-end;gap:6px}.table-menu{width:180px;padding:4px}
    .table-menu button{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;border:0;padding:6px 10px;background:transparent;border-radius:3px}
    .table-menu kbd{font:10px sans-serif;opacity:.6;white-space:nowrap}
    .table-ui button:disabled{opacity:.35;cursor:default}
    </style><div class="table-tools" role="toolbar" aria-label="表格工具">
    ${button('调整表格行列', 'resize', icon('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'))}
    ${button('列左对齐', 'left', icon('<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>'))}
    ${button('列居中对齐', 'center', icon('<path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>'))}
    ${button('列右对齐', 'right', icon('<path d="M4 5h16M10 10h10M4 15h16M10 20h10"/>'))}
    <span class="table-size"></span>
    ${button('更多表格操作', 'more', icon('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'))}
    ${button('删除表格', 'delete-table', icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'))}
    </div><form class="table-popup table-resize" aria-label="调整表格行列" hidden>
      <label>行数（含表头）<input name="rows" type="number" min="1" max="10000" required aria-label="表格行数（含表头）"></label>
      <label>列数<input name="columns" type="number" min="1" max="200" required aria-label="表格列数"></label>
      <div class="form-actions"><button type="button" class="table-cancel">取消</button><button type="submit">应用行列数</button></div>
    </form><div class="table-popup table-menu" role="menu" aria-label="更多表格操作" hidden>
    ${menuItems.map(([key, label]) => `<button type="button" role="menuitem" aria-label="${label}" data-command="${key}">${label}<kbd>${({ 'insert-row-below': 'Ctrl+Enter', 'move-row-up': 'Alt+↑', 'move-row-down': 'Alt+↓', 'move-column-left': 'Alt+←', 'move-column-right': 'Alt+→' })[key] || ''}</kbd></button>`).join('')}
    </div>`;
  main.append(host);
  const bar = host.querySelector('.table-tools'), form = host.querySelector('form'), menu = host.querySelector('.table-menu');
  let context, geometry, popup = null;
  const close = () => { form.hidden = true; menu.hidden = true; popup = null; };
  function placePopup() {
    if (!popup || !geometry) return;
    const panel = popup === 'resize' ? form : menu;
    const x = popup === 'resize' ? geometry.x : geometry.x + geometry.width - panel.offsetWidth;
    const below = geometry.y + 32;
    panel.style.left = `${Math.max(4, Math.min(main.clientWidth - panel.offsetWidth - 4, x))}px`;
    panel.style.maxHeight = `${Math.max(80, main.clientHeight - 8)}px`;
    panel.style.top = `${below + panel.offsetHeight > main.clientHeight ? Math.max(4, geometry.y - panel.offsetHeight - 4) : below}px`;
  }
  function run(command, options) { close(); action(command, options); focusEditor(); }
  host.querySelectorAll('button[data-command]').forEach(button => {
    button.onclick = () => {
      const command = button.dataset.command;
      if (command === 'resize') {
        const open = popup !== 'resize'; close(); if (!open) { focusEditor(); return; }
        form.elements.rows.value = context.rowCount; form.elements.columns.value = context.columns;
        form.hidden = false; popup = 'resize'; placePopup(); form.elements.rows.focus(); form.elements.rows.select();
      } else if (command === 'more') {
        const open = popup !== 'more'; close(); if (!open) { focusEditor(); return; }
        menu.hidden = false; popup = 'more'; placePopup(); menu.querySelector('button:not(:disabled)')?.focus();
      } else if (['left', 'center', 'right'].includes(command)) run('align', { align: command });
      else run(command);
    };
  });
  form.onsubmit = event => { event.preventDefault(); run('resize', { rows: Number(form.elements.rows.value), columns: Number(form.elements.columns.value) }); };
  host.querySelector('.table-cancel').onclick = () => { close(); focusEditor(); };
  return { owns: node => host.contains(node), close, get open() { return !!popup; },
    update(next, rect) {
      context = next; geometry = rect;
      host.hidden = !next;
      if (!next) { close(); return; }
      Object.assign(bar.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px` });
      host.querySelector('.table-size').textContent = `${next.rowCount} × ${next.columns} · C${next.column + 1}`;
      for (const align of ['left', 'center', 'right']) host.querySelector(`[data-command="${align}"]`).setAttribute('aria-pressed', String(next.alignments[next.column] === align));
      const disabled = { 'insert-row-above': next.row === 0, 'move-row-up': next.row <= 1, 'move-row-down': next.row === 0 || next.row >= next.rowCount - 1,
        'move-column-left': next.column === 0, 'move-column-right': next.column === next.columns - 1 };
      Object.entries(disabled).forEach(([key, value]) => { host.querySelector(`[data-command="${key}"]`).disabled = value; });
      placePopup();
    }, destroy() { host.remove(); }
  };
}
