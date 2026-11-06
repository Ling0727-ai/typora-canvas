// Refresh standalone defaults from the user's separately maintained plugin.
// At runtime, installed Typora styles/config take precedence over this snapshot.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const at = process.argv.indexOf('--source');
if (at < 0 || !process.argv[at + 1]) throw new Error('Usage: node scripts/sync-callouts.mjs --source <typora-obsidian-callouts>');
const source = resolve(process.argv[at + 1]);
const css = await readFile(join(source, 'styles/callouts.css'), 'utf8');
const dark = await readFile(join(source, 'styles/callouts-dark.css'), 'utf8');
const types = {};
for (const match of css.matchAll(/#write \.plugin-callout\[callout-type="(\w+)"\]\s*\{([^}]+)\}/g)) {
  const rgb = /--obs-callout-rgb:\s*var\([^,]+,\s*([\d, ]+)\)/.exec(match[2])?.[1];
  const icon = /--obs-callout-icon:\s*url\("([^"]+)"\)/.exec(match[2])?.[1];
  if (rgb) types[match[1]] = { color: `rgb(${rgb.trim()})`, borderColor: `rgba(${rgb.trim()}, .7)`, iconUrl: icon || '' };
}
for (const [type, rgb] of [...dark.matchAll(/--obs-(\w+)-rgb:\s*([\d, ]+);/g)].map(m => [m[1], m[2].trim()])) {
  if (types[type]) Object.assign(types[type], { darkColor: `rgb(${rgb})`, darkBorderColor: `rgba(${rgb}, .7)` });
}
types.caution ||= { ...types.warning };
await writeFile('src/callout-defaults.json', JSON.stringify({ source: 'Ling0727-ai/typora-obsidian-callouts (MIT, 2026)', types }, null, 2) + '\n');
await mkdir('licenses', { recursive: true });
await writeFile('licenses/typora-obsidian-callouts.MIT.txt', await readFile(join(source, 'LICENSE'), 'utf8'));
console.log(`Synced ${Object.keys(types).length} callout types, colors and embedded SVG icons.`);
