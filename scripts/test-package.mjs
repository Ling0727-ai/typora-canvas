import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { parse } from 'smol-toml';
const meta = JSON.parse(await readFile('package.json', 'utf8'));
const sandbox = await mkdtemp(join(tmpdir(), 'typora-canvas-package-'));
try {
  const prefix = join(sandbox, 'npm prefix'), home = join(sandbox, 'user home'), resources = join(sandbox, 'Typora resources 中文');
  await mkdir(home, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const run = (args, code = 0) => {
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, code, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`); return result.stdout;
  };
  const tarball = resolve(`dist/release/${meta.name.replace(/^@/, '').replace('/', '-')}-${meta.version}.tgz`);
  run([process.env.npm_execpath, 'install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  const packageRoot = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', meta.name);
  const bin = process.platform === 'win32' ? join(packageRoot, 'scripts/install.mjs') : join(prefix, 'bin/typora-canvas');
  await access(process.platform === 'win32' ? join(prefix, 'typora-canvas.cmd') : bin);
  assert.equal(run([bin, '--version']).trim(), meta.version);
  assert.match(run([bin, '--help']), /Usage: typora-canvas/);
  const distribution = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(distribution.dependencies, undefined, 'release CLI has no runtime npm dependencies');
  assert.equal(distribution.scripts, undefined, 'no install/build lifecycle hooks');
  await mkdir(join(resources, 'plugin/global/core'), { recursive: true });
  await mkdir(join(resources, 'plugin/global/settings'), { recursive: true });
  await writeFile(join(resources, 'plugin/global/core/index.js'), '// simulated framework\n');
  await writeFile(join(resources, 'plugin/global/settings/settings.default.toml'), '[global]\nENABLE = true\n');
  const config = join(resources, 'plugin/global/settings/settings.user.toml');
  await writeFile(config, '[other]\nENABLE = true\n');
  run([bin, '--resources', resources, '--mode', 'canvas-editor', '--dry-run']);
  assert.equal(await readFile(config, 'utf8'), '[other]\nENABLE = true\n');
  await assert.rejects(access(join(resources, 'plugin/canvas_reader.js')));
  run([bin, '--resources', resources, '--mode', 'canvas-editor']);
  let settings = parse(await readFile(config, 'utf8'));
  assert.equal(settings.other.ENABLE, true); assert.equal(settings.canvas_reader.RENDER_MODE, 'canvas-editor');
  assert.equal(settings.canvas_reader.ENABLE, true);
  for (const file of ['canvas_reader.js', 'canvas_reader/runtime.cjs', 'canvas_reader/version.json']) {
    assert.deepEqual(await readFile(join(resources, 'plugin', file)), await readFile(join('dist/plugin', file)));
  }
  run([bin, '--resources', resources]);
  assert.equal(parse(await readFile(config, 'utf8')).canvas_reader.RENDER_MODE, 'canvas-editor');
  run([bin, '--resources', resources, '--uninstall']);
  settings = parse(await readFile(config, 'utf8')); assert.equal(settings.canvas_reader.ENABLE, false); assert.equal(settings.other.ENABLE, true);
  await access(join(resources, 'plugin/canvas_reader/runtime.cjs'));
  const zip = unzipSync(new Uint8Array(await readFile(`dist/release/typora-canvas-v${meta.version}.zip`)));
  assert.ok(zip['canvas_reader.js'] && zip['canvas_reader/runtime.cjs'] && zip['README_CN_simplised.md']);
  assert.equal(JSON.parse(new TextDecoder().decode(zip['canvas_reader/version.json'])).version, meta.version);
  console.log('Packaged install passed: global npm install without build scripts/dependencies; CLI help/version, dry-run, install, update, disable, symlink entry and ZIP payload.');
} finally {
  // mkdtemp's exact directory is owned exclusively by this smoke test.
  await rm(sandbox, { recursive: true, force: true });
}
