import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, cp } from 'node:fs/promises';
import hljs from 'highlight.js';
await mkdir('dist/plugin/canvas_reader', { recursive: true });
await mkdir('dist/demo', { recursive: true });
const worker = await build({ entryPoints: ['src/formula-worker.js'], bundle: true, platform: 'browser',
  format: 'iife', write: false, target: 'chrome120', define: { global: 'globalThis' } });
const codeWorker = await build({ entryPoints: ['src/code-worker.js'], bundle: true, platform: 'browser', format: 'iife', write: false, target: 'chrome120' });
const languages = [...hljs.listLanguages().map(id => ({ id, label: hljs.getLanguage(id).name || id, aliases: hljs.getLanguage(id).aliases || [] })),
  { id: 'cassandra', label: 'Cassandra', aliases: ['cql'] }];
const common = { bundle: true, loader: { '.css': 'text' }, target: 'chrome120', sourcemap: true, legalComments: 'eof',
  define: { __MATH_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text),
    __CODE_WORKER_SOURCE__: JSON.stringify(codeWorker.outputFiles[0].text), __CODE_LANGUAGES__: JSON.stringify(languages) } };
await Promise.all([
  build({ ...common, entryPoints: ['src/runtime.js'], outfile: 'dist/plugin/canvas_reader/runtime.cjs', format: 'cjs', platform: 'browser' }),
  build({ ...common, entryPoints: ['src/demo.js'], outfile: 'dist/demo/demo.js', format: 'iife', platform: 'browser' }),
  copyFile('plugin/canvas_reader.cjs', 'dist/plugin/canvas_reader.js'),
  copyFile('demo/index.html', 'dist/demo/index.html')
]);
await cp('licenses', 'dist/plugin/canvas_reader/licenses', { recursive: true });
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/plugin/canvas_reader/THIRD_PARTY_NOTICES.md');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/plugin/canvas_reader/version.json', JSON.stringify({ version: packageJson.version }, null, 2));
console.log('Built Typora plugin and standalone preview in dist/');
