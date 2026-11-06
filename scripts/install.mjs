#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, copyFile, access, rename, rm, realpath } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse } from 'smol-toml';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function exists(path) { try { await access(path); return true; } catch { return false; } }

export function configure(raw, enable, { mode } = {}) {
  const before = parse(raw);
  if (before.canvas_reader && typeof before.canvas_reader !== 'object') throw new Error('canvas_reader must be a TOML table');
  const pattern = /^\[canvas_reader\][^\r\n]*\r?\n[\s\S]*?(?=^\[|$(?![\s\S]))/m;
  let section = raw.match(pattern)?.[0] || '[canvas_reader]\n';
  const values = { ENABLE: String(enable), NAME: '"Typora Canvas"', HOTKEY: '"ctrl+alt+shift+f8"',
    AUTO_OPEN: before.canvas_reader?.AUTO_OPEN === false ? 'false' : 'true',
    RENDER_MODE: JSON.stringify(mode || (['canvas', 'canvas-editor'].includes(before.canvas_reader?.RENDER_MODE)
      ? before.canvas_reader.RENDER_MODE : 'hybrid')) };
  for (const [key, value] of Object.entries(values)) {
    if (!enable && key !== 'ENABLE') continue;
    const assignment = new RegExp(`^${key}\\s*=.*$`, 'm');
    if (assignment.test(section)) section = section.replace(assignment, `${key} = ${value}`);
    else section = section.trimEnd() + `\n${key} = ${value}\n`;
  }
  const result = pattern.test(raw) ? raw.replace(pattern, () => section.trimEnd() + '\n\n') : raw.trimEnd() + '\n\n' + section;
  const after = parse(result);
  for (const key of Object.keys(before).filter(k => k !== 'canvas_reader')) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`Unexpected config change: ${key}`);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: typora-canvas [--resources <directory>] [--mode hybrid|canvas-editor|canvas] [--dry-run] [--uninstall]\nRequires an installed and enabled obgnail/typora_plugin framework.\nWindows defaults to C:/Program Files/Typora/resources; other systems require --resources.\nUse --version to print the package version.');
    return;
  }
  if (args.includes('--version')) { console.log(JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version); return; }
  const resourcesAt = args.indexOf('--resources');
  if (resourcesAt === -1 && process.platform !== 'win32') throw new Error('Please specify the installed framework resource directory with --resources <directory>.');
  if (resourcesAt !== -1 && !args[resourcesAt + 1]) throw new Error('--resources requires a path');
  const resources = resolve(resourcesAt === -1 ? 'C:/Program Files/Typora/resources' : args[resourcesAt + 1]);
  const pluginRoot = join(resources, 'plugin');
  if (!await exists(join(pluginRoot, 'global/core/index.js'))) {
    throw new Error('先安装 obgnail/typora_plugin。本工具只安装扩展，不改写 Typora 的 window.html。');
  }
  const homeConfig = join(homedir(), '.config/typora_plugin/settings.user.toml');
  const localConfig = join(pluginRoot, 'global/settings/settings.user.toml');
  const config = await exists(homeConfig) ? homeConfig : localConfig;
  const original = await exists(config) ? await readFile(config, 'utf8') : '';
  const enabled = !args.includes('--uninstall');
  const modeAt = args.indexOf('--mode'), mode = modeAt < 0 ? undefined : args[modeAt + 1];
  if (modeAt >= 0 && !['hybrid', 'canvas', 'canvas-editor'].includes(mode)) throw new Error('--mode 必须是 hybrid、canvas 或 canvas-editor');
  const modified = configure(original, enabled, { mode });
  const defaults = parse(await readFile(join(pluginRoot, 'global/settings/settings.default.toml'), 'utf8'));
  const local = await exists(localConfig) ? parse(await readFile(localConfig, 'utf8')) : {};
  const home = await exists(homeConfig) ? parse(await readFile(homeConfig, 'utf8')) : {};
  if (enabled && ![defaults, local, home].reduce((a, b) => ({ ...a, ...b.global }), {}).ENABLE) {
    throw new Error('插件框架 [global].ENABLE 未开启。请先确认现有框架可用。');
  }
  const targetEntry = join(pluginRoot, 'canvas_reader.js');
  const targetAssets = join(pluginRoot, 'canvas_reader');
  if (enabled && !await exists(join(repo, 'dist/plugin/canvas_reader/runtime.cjs'))) throw new Error('请先执行 npm run build');
  if (enabled) {
    // Check the host's CommonJS loader can read the compiled artifact.
    const require = createRequire(import.meta.url);
    const runtime = require(join(repo, 'dist/plugin/canvas_reader/runtime.cjs'));
    if (typeof runtime.mountReader !== 'function' || typeof runtime.mountHybrid !== 'function') throw new Error('Invalid runtime bundle');
  }
  const backup = join(homedir(), '.config/typora-canvas/backups', new Date().toISOString().replace(/[:.]/g, '-'));
  console.log(JSON.stringify({ action: enabled ? 'install' : 'disable', resources, config, backup }, null, 2));
  if (args.includes('--dry-run')) return;
  await mkdir(backup, { recursive: true });
  await writeFile(join(backup, 'settings.user.toml'), original, 'utf8');
  if (await exists(targetEntry)) await copyFile(targetEntry, join(backup, 'canvas_reader.js'));
  if (await exists(targetAssets)) await cp(targetAssets, join(backup, 'canvas_reader'), { recursive: true });
  try {
    if (enabled) {
      await cp(join(repo, 'dist/plugin/canvas_reader'), targetAssets, { recursive: true });
      await copyFile(join(repo, 'dist/plugin/canvas_reader.js'), targetEntry);
    }
    await mkdir(dirname(config), { recursive: true });
    const temp = `${config}.typora-canvas.tmp`;
    await writeFile(temp, modified, 'utf8');
    await rename(temp, config);
  } catch (error) {
    await writeFile(config, original, 'utf8').catch(() => {});
    if (await exists(join(backup, 'canvas_reader.js'))) await copyFile(join(backup, 'canvas_reader.js'), targetEntry);
    else if (enabled) await rm(targetEntry, { force: true });
    if (await exists(join(backup, 'canvas_reader'))) await cp(join(backup, 'canvas_reader'), targetAssets, { recursive: true });
    else if (enabled) await rm(targetAssets, { recursive: true, force: true });
    throw error;
  }
  console.log(enabled ? `安装完成。模式：${parse(modified).canvas_reader.RENDER_MODE}。保存笔记并重启 Typora。Ctrl+Alt+Shift+F8 切换开关。` : '已禁用。重启 Typora 后生效，插件文件保留，便于恢复。');
}
// Canonicalize both sides: Windows temporary/home paths can use 8.3 aliases,
// while npm exposes symlinked command paths on Unix.
const canonical = async path => {
  const value = await realpath(path).catch(() => '');
  return process.platform === 'win32' ? value.toLowerCase() : value;
};
if (process.argv[1] && await canonical(process.argv[1]) === await canonical(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
