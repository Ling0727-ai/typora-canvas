// Fenwick tree: offset lookup and measured-height updates in O(log n).
export class HeightIndex {
  constructor(heights) {
    this.values = Float64Array.from(heights);
    this.tree = new Float64Array(heights.length + 1);
    for (let i = 1; i < this.tree.length; i++) {
      this.tree[i] += this.values[i - 1];
      const parent = i + (i & -i);
      if (parent < this.tree.length) this.tree[parent] += this.tree[i];
    }
  }
  get length() { return this.values.length; }
  prefix(end) {
    let sum = 0;
    for (let i = Math.min(end, this.length); i > 0; i -= i & -i) sum += this.tree[i];
    return sum;
  }
  get total() { return this.prefix(this.length); }
  update(index, height) {
    if (index < 0 || index >= this.length || !Number.isFinite(height) || height <= 0) {
      throw new RangeError('Invalid block height');
    }
    const delta = height - this.values[index];
    this.values[index] = height;
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta;
    return delta;
  }
  find(offset) {
    if (!this.length) return 0;
    let index = 0;
    let sum = 0;
    let step = 2 ** Math.floor(Math.log2(this.length));
    for (; step; step = Math.floor(step / 2)) {
      const next = index + step;
      if (next <= this.length && sum + this.tree[next] <= offset) {
        index = next;
        sum += this.tree[next];
      }
    }
    return Math.min(index, this.length - 1);
  }
}
