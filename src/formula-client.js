/* global __MATH_WORKER_SOURCE__ */
// An isolated worker avoids colliding with Typora's own MathJax version and
// keeps TeX layout off the editor's input/paint thread.
export class FormulaEngine {
  worker = null;
  pending = new Map();
  sequence = 0;
  render(tex, options) {
    if (!this.worker) {
      const url = URL.createObjectURL(new Blob([__MATH_WORKER_SOURCE__], { type: 'text/javascript' }));
      try { this.worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      this.worker.onmessage = ({ data }) => {
        const job = this.pending.get(data.id); if (!job) return;
        clearTimeout(job.timer); this.pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
      };
      this.worker.onerror = () => this.destroy('公式线程启动失败');
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.destroy('公式排版超时'), 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, tex, options });
    });
  }
  destroy(message = '公式线程已关闭') {
    this.worker?.terminate(); this.worker = null;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error(message)); }
    this.pending.clear();
  }
}
