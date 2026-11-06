import { formulaSvg } from './formula.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, result: formulaSvg(data.tex, data.options) }); }
  catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
};
