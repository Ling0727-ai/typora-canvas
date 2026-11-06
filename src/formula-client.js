/* global __MATH_WORKER_SOURCE__ */
function createFormulaWorker() {
  const url = URL.createObjectURL(new Blob([__MATH_WORKER_SOURCE__], { type: 'text/javascript' }));
  try { return new Worker(url); } finally { URL.revokeObjectURL(url); }
}

// A worker executes one equation at a time. Waiting for startup or an earlier
// equation must not consume this equation's execution timeout.
export class FormulaEngine {
  constructor({ createWorker = createFormulaWorker, timeout = 5000, startupTimeout = 15000 } = {}) {
    Object.assign(this, { createWorker, timeout, startupTimeout });
    this.worker = null; this.ready = false; this.pending = new Map(); this.active = null;
    this.sequence = 0; this.timer = null;
    this.stats = { submitted: 0, completed: 0, failed: 0, restarts: 0 };
  }
  render(tex, options, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('公式任务已取消', 'AbortError')); return; }
      const job = { id: ++this.sequence, tex, options, resolve, reject, signal };
      job.abort = () => {
        if (!this.pending.delete(job.id)) return;
        this.settle(job, new DOMException('公式任务已取消', 'AbortError'));
        // An executing equation can finish; cancelling a queued item must
        // not restart a healthy worker or disturb any other result.
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      this.pending.set(job.id, job); this.stats.submitted++; this.pump();
    });
  }
  settle(job, error, result) {
    job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error); else job.resolve(result);
  }
  stopWorker() {
    clearTimeout(this.timer); this.timer = null;
    this.worker?.terminate(); this.worker = null; this.ready = false; this.active = null;
  }
  pump() {
    if (!this.pending.size || this.active) return;
    if (!this.worker) {
      let worker;
      try { worker = this.createWorker(); }
      catch (error) { this.destroy(`公式线程启动失败：${error.message}`); return; }
      this.worker = worker;
      this.timer = setTimeout(() => this.destroy('公式线程启动超时'), this.startupTimeout);
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        if (data.type === 'ready') {
          clearTimeout(this.timer); this.timer = null; this.ready = true; this.pump(); return;
        }
        const job = this.active;
        if (!job || data.id !== job.id) return;
        clearTimeout(this.timer); this.timer = null; this.active = null;
        if (this.pending.delete(job.id)) {
          this.stats[data.error ? 'failed' : 'completed']++;
          this.settle(job, data.error ? new Error(data.error) : null, data.result);
        }
        this.pump();
      };
      worker.onerror = event => {
        event.preventDefault?.();
        if (this.worker !== worker) return;
        if (!this.ready) this.destroy('公式线程启动失败');
        else this.failActive('公式线程运行失败');
      };
      return;
    }
    if (!this.ready) return;
    this.active = this.pending.values().next().value;
    this.timer = setTimeout(() => this.failActive('公式排版超时'), this.timeout);
    try { this.worker.postMessage({ id: this.active.id, tex: this.active.tex, options: this.active.options }); }
    catch (error) { this.failActive(`公式任务发送失败：${error.message}`); }
  }
  failActive(message) {
    const job = this.active;
    if (job && this.pending.delete(job.id)) { this.stats.failed++; this.settle(job, new Error(message)); }
    this.stopWorker(); this.stats.restarts++; this.pump();
  }
  getStats() { return { ...this.stats, queued: this.pending.size - (this.active && this.pending.has(this.active.id) ? 1 : 0), active: !!this.active }; }
  destroy(message = '公式线程已关闭') {
    this.stopWorker();
    for (const job of this.pending.values()) this.settle(job, new Error(message));
    this.pending.clear();
  }
}
