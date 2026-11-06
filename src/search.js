// This function is also serialized into a worker; keep it self-contained.
export function matchBlocks(texts, query, { regex = false, caseSensitive = false, limit = 5000 } = {}) {
  if (!query) return { blocks: [], truncated: false };
  const expression = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(expression, `mu${caseSensitive ? '' : 'i'}`);
  const blocks = [];
  for (let i = 0; i < texts.length; i++) {
    if (pattern.test(texts[i])) {
      if (blocks.length >= limit) return { blocks, truncated: true };
      blocks.push(i);
    }
  }
  return { blocks, truncated: false };
}

// Regex may backtrack indefinitely. A dedicated worker can be terminated;
// a timer on the UI thread alone cannot interrupt a blocking RegExp.test().
export class BlockSearch {
  active = null;
  cancel() { this.active?.cancel(); }
  search(texts, query, options) {
    this.cancel();
    if (!query) return Promise.resolve({ blocks: [], truncated: false });
    return new Promise((resolve, reject) => {
      const source = `self.onmessage=({data})=>{try{self.postMessage({result:(${matchBlocks.toString()})(data.texts,data.query,data.options)})}catch(e){self.postMessage({error:e.message})}}`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      let worker, timer, task;
      const clean = () => {
        clearTimeout(timer); worker?.terminate(); URL.revokeObjectURL(url);
        if (this.active === task) this.active = null;
      };
      try { worker = new Worker(url); } catch (error) { clean(); reject(error); return; }
      task = { cancel: () => { clean(); reject(new Error('Search cancelled')); } };
      this.active = task;
      worker.onmessage = ({ data }) => { clean(); if (data.error) reject(new Error(data.error)); else resolve(data.result); };
      worker.onerror = () => { clean(); reject(new Error('搜索线程启动失败')); };
      timer = setTimeout(() => { clean(); reject(new Error('正则搜索超时，请简化表达式')); }, 1000);
      worker.postMessage({ texts, query, options });
    });
  }
}
