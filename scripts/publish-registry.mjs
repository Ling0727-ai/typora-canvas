import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const meta = JSON.parse(await readFile('package.json', 'utf8'));
if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF_NAME !== `v${meta.version}`) throw new Error('Publishing requires the matching version tag');
const archive = resolve(`dist/release/${meta.name.replace(/^@/, '').replace('/', '-')}-${meta.version}.tgz`);
await access(archive);
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(meta.name)}/${meta.version}`, {
  headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
if (response.ok) {
  const published = await response.json();
  if (published.name !== meta.name || published.version !== meta.version) throw new Error('Unexpected registry package metadata');
  console.log(`${meta.name}@${meta.version} is already published; leaving the immutable version and dist-tags unchanged.`);
} else if (response.status === 404) {
  if (!process.env.npm_execpath) throw new Error('Run with npm run publish:registry');
  const args = [process.env.npm_execpath, 'publish', archive, '--access', 'public', '--tag', 'latest'];
  if (process.argv.includes('--dry-run')) args.push('--dry-run');
  if (process.env.GITHUB_ACTIONS === 'true') args.push('--provenance');
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else throw new Error(`Registry lookup failed (HTTP ${response.status}); refusing to treat this as an unpublished version.`);
