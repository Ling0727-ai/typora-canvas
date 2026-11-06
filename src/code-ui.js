import { languageSuggestions, languageLabel } from './code-client.js';
export function mountCodeUI(main, { choose, focusEditor }) {
  const host = document.createElement('div'); host.className = 'code-ui'; host.hidden = true;
  host.innerHTML = `<style>.code-ui{position:absolute;inset:0;z-index:5;pointer-events:none}.code-ui[hidden],.code-ui [hidden]{display:none!important}
    .code-language{position:absolute;pointer-events:auto;padding:3px 7px;border:0;background:transparent;font:12px sans-serif;opacity:.8}
    .code-picker{position:absolute;pointer-events:auto;width:260px;max-width:calc(100% - 10px);padding:6px;background:var(--tc-bg,#fff);border:1px solid #8997b377;border-radius:5px;box-shadow:0 4px 16px #0002}
    .code-picker input{width:100%;margin-bottom:5px}.code-options{max-height:200px;overflow:auto}.code-options button{display:block;width:100%;text-align:left;background:transparent;border:0;padding:5px 8px}
    .code-options button[aria-selected=true]{background:#4c80d133}.code-options small{opacity:.6;margin-left:10px}
    </style><button class="code-language" type="button" aria-label="代码块语言"></button><div class="code-picker" hidden>
    <input aria-label="筛选代码语言" placeholder="语言名称或别名"><div class="code-options" role="listbox" aria-label="代码语言建议"></div></div>`;
  main.append(host);
  const badge = host.querySelector('.code-language'), panel = host.querySelector('.code-picker'), filter = host.querySelector('input'), list = host.querySelector('.code-options');
  let context = null, geometry, mode = null, choices = [], selected = 0, previousQuery = null;
  const close = () => { panel.hidden = true; mode = null; previousQuery = null; };
  function render(query) {
    if (query === previousQuery) return;
    previousQuery = query; choices = languageSuggestions(query); selected = 0; list.replaceChildren();
    choices.forEach((language, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(i === selected)); button.textContent = language.label;
      const id = document.createElement('small'); id.textContent = language.id; button.append(id);
      button.onpointerdown = event => event.preventDefault();
      button.onclick = () => accept(i); list.append(button);
    });
    if (!choices.length) list.textContent = '无匹配语言，可保留自定义名称';
  }
  function place() {
    if (!geometry) return;
    Object.assign(badge.style, { left: `${geometry.x}px`, top: `${geometry.y}px` });
    panel.style.left = `${Math.max(4, Math.min(main.clientWidth - 264, geometry.x))}px`;
    panel.style.top = `${Math.max(4, Math.min(main.clientHeight - 100, geometry.y + 27))}px`;
  }
  function accept(index = selected) {
    if (!choices[index]) return;
    const advance = mode === 'auto', language = choices[index].id; close(); choose(language, advance); focusEditor();
  }
  badge.onclick = () => {
    mode = 'manual'; panel.hidden = false; filter.hidden = false; filter.value = context.language || '';
    render(filter.value); place(); filter.focus(); filter.select();
  };
  filter.oninput = () => render(filter.value);
  return { owns: node => host.contains(node), close, get open() { return !!mode; },
    update(next, rect, autoQuery = null) {
      context = next; geometry = rect; host.hidden = !next;
      if (!next) { close(); return; }
      badge.textContent = `${languageLabel(next.language)} ▾`; place();
      if (autoQuery !== null && autoQuery.length) { mode = 'auto'; filter.hidden = true; panel.hidden = false; render(autoQuery); }
      else if (mode === 'auto') close();
    },
    key(event) {
      if (!mode) return false;
      if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); selected = Math.max(0, Math.min(choices.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
        [...list.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === selected))); list.children[selected]?.scrollIntoView({ block: 'nearest' }); return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && choices.length) { event.preventDefault(); accept(); return true; }
      if (event.key === 'Escape') { event.preventDefault(); close(); focusEditor(); return true; }
      return false;
    }, destroy() { host.remove(); }
  };
}
