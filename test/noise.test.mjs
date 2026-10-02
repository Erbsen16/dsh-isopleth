import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fbm, hashSeed, valueNoise2D } from '../src/noise.mjs';

test('hashSeed 稳定且对 seed 敏感', () => {
  assert.equal(hashSeed('isopleth-01'), hashSeed('isopleth-01'));
  assert.notEqual(hashSeed('a'), hashSeed('b'));
  assert.equal(hashSeed(42), hashSeed('42'));
});

test('valueNoise2D 落在 [0,1) 且可复现', () => {
  for (let i = 0; i < 200; i++) {
    const x = i * 0.37;
    const y = i * -0.11;
    const v = valueNoise2D(x, y, 12345);
    assert.ok(v >= 0 && v < 1, `越界: ${v}`);
    assert.equal(v, valueNoise2D(x, y, 12345));
  }
});

test('fbm 落在 [0,1) 且格点边界连续（不出现台阶跳变）', () => {
  const seed = hashSeed('t');
  let maxJump = 0;
  let prev = fbm(0, 0, seed);
  for (let i = 1; i <= 4000; i++) {
    const v = fbm(i * 0.01, 0.5, seed);
    assert.ok(v >= 0 && v < 1, `越界: ${v}`);
    maxJump = Math.max(maxJump, Math.abs(v - prev));
    prev = v;
  }
  // 相邻 0.01 世界单位的高度差应远小于量程；出现大跳变说明插值写坏了
  assert.ok(maxJump < 0.05, `相邻采样跳变过大: ${maxJump}`);
});

test('不同 seed 产生不同地形', () => {
  const a = fbm(1.5, 2.5, hashSeed('isopleth-01'));
  const b = fbm(1.5, 2.5, hashSeed('ridge-07'));
  assert.notEqual(a, b);
});
