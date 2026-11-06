import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { readFile, writeFile, mkdir, cp, readdir, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const meta = JSON.parse(await readFile('package.json', 'utf8'));
const stage = resolve('dist/package'), output = resolve('dist/release');
await mkdir(join(stage, 'scripts'), { recursive: true });
await mkdir(join(stage, '.github'), { recursive: true });
await mkdir(output, { recursive: true });
await cp('dist/plugin', join(stage, 'dist/plugin'), { recursive: true });
const documentation = ['README.md', 'README_CN_simplised.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.github/PUBLISHING.md'];
for (const file of documentation) await cp(file, join(stage, file));
await build({ entryPoints: ['scripts/install.mjs'], outfile: join(stage, 'scripts/install.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20', legalComments: 'eof' });
await chmod(join(stage, 'scripts/install.mjs'), 0o755);
await writeFile(join(stage, 'package.json'), JSON.stringify({ name: meta.name, version: meta.version,
  description: meta.description, type: 'module', license: 'MIT', engines: meta.engines,
  repository: { type: 'git', url: 'git+https://github.com/Ling0727-ai/typora-canvas.git' },
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
  bin: { 'typora-canvas': 'scripts/install.mjs' },
  files: ['dist/plugin/', 'scripts/install.mjs', 'README_CN_simplised.md', 'THIRD_PARTY_NOTICES.md', '.github/PUBLISHING.md'] }, null, 2) + '\n');
// npm supplies its own CLI path, avoiding shell-dependent npm.cmd invocation.
if (!process.env.npm_execpath) throw new Error('Run packaging with npm run package.');
const pack = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', stage, '--pack-destination', output, '--ignore-scripts', '--json'], { encoding: 'utf8' });
if (pack.status !== 0) throw new Error(pack.stderr || pack.error || 'npm pack failed');
const [{ filename }] = JSON.parse(pack.stdout), entries = {};
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name, file = join(directory, entry.name);
    if (entry.isDirectory()) await collect(file, relative + '/');
    else entries[relative] = [new Uint8Array(await readFile(file)), { mtime: new Date('2020-01-01T00:00:00Z') }];
  }
}
await collect(resolve('dist/plugin'));
for (const file of documentation) entries[file] = new Uint8Array(await readFile(file));
const zip = `typora-canvas-v${meta.version}.zip`;
await writeFile(join(output, zip), zipSync(entries));
const sums = [];
for (const file of [zip, filename]) sums.push(`${createHash('sha256').update(await readFile(join(output, file))).digest('hex')}  ${file}`);
await writeFile(join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`Release files: ${zip}, ${filename}, SHA256SUMS.txt`);
