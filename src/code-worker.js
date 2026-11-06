import hljs from 'highlight.js';
hljs.registerAliases(['cassandra', 'cql'], { languageName: 'sql' });
self.onmessage = ({ data }) => {
  try {
    const language = hljs.getLanguage(data.language) ? data.language : 'plaintext';
    const result = hljs.highlight(data.source, { language, ignoreIllegals: true });
    // The emitter contains token scopes and text, not executable document HTML.
    let offset = 0; const tokens = [];
    function walk(node, scope = '') {
      if (typeof node === 'string') { if (scope) tokens.push({ from: offset, to: offset + node.length, type: scope.split(/[ .]/)[0] }); offset += node.length; }
      else for (const child of node.children || []) walk(child, node.scope || scope);
    }
    walk(result._emitter.rootNode);
    self.postMessage({ id: data.id, tokens });
  } catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
};
