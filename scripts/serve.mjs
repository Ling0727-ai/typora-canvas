import './build.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const port = Number(process.env.PORT || 4173);
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/demo.js': ['demo.js', 'text/javascript; charset=utf-8'], '/demo.js.map': ['demo.js.map', 'application/json'] };
createServer(async (req, res) => {
  const entry = files[new URL(req.url, 'http://localhost').pathname];
  if (!entry) { res.writeHead(404); res.end('Not found'); return; }
  try { res.setHeader('Content-Type', entry[1]); res.end(await readFile(`dist/demo/${entry[0]}`)); }
  catch { res.writeHead(500); res.end('Build unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
