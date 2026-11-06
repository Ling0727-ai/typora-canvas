/* global __CODE_WORKER_SOURCE__, __CODE_LANGUAGES__ */
export const codeLanguages = typeof __CODE_LANGUAGES__ === 'undefined' ? [{ id: 'c', label: 'C' }, { id: 'cpp', label: 'C++' }] : __CODE_LANGUAGES__;
export function languageSuggestions(query = '') {
  const q = query.toLowerCase().trim();
  const matches = codeLanguages.filter(l => !q || [l.id, l.label, ...(l.aliases || [])].some(s => s.toLowerCase().startsWith(q)));
  matches.sort((a, b) => Number(b.id === q) - Number(a.id === q));
  return matches.slice(0, 30);
}
export function languageLabel(id) { return codeLanguages.find(l => l.id === id)?.label || id || 'Plain text'; }
export class CodeHighlighter {
  worker = null; pending = new Map(); sequence = 0;
  highlight(source, language) {
    if (!language || source.length > 200000) return Promise.resolve([]);
    if (!this.worker) {
      const url = URL.createObjectURL(new Blob([__CODE_WORKER_SOURCE__], { type: 'text/javascript' }));
      try { this.worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      this.worker.onmessage = ({ data }) => {
        const job = this.pending.get(data.id); if (!job) return;
        clearTimeout(job.timer); this.pending.delete(data.id); job.resolve(data.tokens || []);
      };
      this.worker.onerror = () => this.destroy();
    }
    return new Promise(resolve => {
      const id = ++this.sequence, timer = setTimeout(() => this.destroy(), 1500);
      this.pending.set(id, { resolve, timer }); this.worker.postMessage({ id, source, language });
    });
  }
  destroy() {
    this.worker?.terminate(); this.worker = null;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.resolve([]); } this.pending.clear();
  }
}
