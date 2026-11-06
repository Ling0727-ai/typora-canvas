import test from 'node:test';
import assert from 'node:assert/strict';
import { matchBlocks } from '../src/search.js';

test('search supports literal metacharacters, Unicode and regular expressions', () => {
  const texts = ['价格 $12.50', 'alpha123', 'beta456', '中文\n第二行', 'a.b'];
  assert.deepEqual(matchBlocks(texts, 'a.b').blocks, [4]);
  assert.deepEqual(matchBlocks(texts, '^(alpha|beta)\\d+$', { regex: true }).blocks, [1, 2]);
  assert.deepEqual(matchBlocks(texts, '^第二行$', { regex: true }).blocks, [3]);
  assert.deepEqual(matchBlocks(texts, '\\p{Script=Han}+', { regex: true }).blocks, [0, 3]);
  assert.deepEqual(matchBlocks(texts, 'ALPHA').blocks, [1]);
  assert.deepEqual(matchBlocks(texts, 'ALPHA', { caseSensitive: true }).blocks, []);
  assert.throws(() => matchBlocks(texts, '[', { regex: true }), SyntaxError);
  assert.equal(matchBlocks(texts, '', { regex: true }).blocks.length, 0);
  assert.equal(matchBlocks(['a', 'a'], 'a', { limit: 1 }).truncated, true);
});
