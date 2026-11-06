import test from 'node:test';
import assert from 'node:assert/strict';
import { usePlatformShortcuts } from './keyboard.mjs';

test('macOS keyboard uses Command for native shortcuts and preserves other keys/options', async () => {
  const calls = [], keyboard = Object.fromEntries(['press', 'down', 'up'].map(method => [method,
    async function (...args) { assert.equal(this, keyboard); calls.push([method, ...args]); }]));
  usePlatformShortcuts({ keyboard }, 'darwin');
  await keyboard.press('Control+Shift+z', { delay: 1 });
  await keyboard.down('Control'); await keyboard.up('Control');
  await keyboard.press('Alt+ArrowUp'); await keyboard.press('Home');
  assert.deepEqual(calls, [['press', 'Meta+Shift+z', { delay: 1 }], ['down', 'Meta'], ['up', 'Meta'], ['press', 'Alt+ArrowUp'], ['press', 'Home']]);
});

test('Windows and Linux keep their original keyboard implementation', () => {
  for (const platform of ['win32', 'linux']) {
    const press = () => {}, keyboard = { press };
    usePlatformShortcuts({ keyboard }, platform); assert.equal(keyboard.press, press);
  }
});
