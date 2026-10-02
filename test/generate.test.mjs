import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { buildTerrain, renderSvg } from '../src/generate.mjs';
import { generateTerrainSvg } from '../src/node.mjs';
import { levelsFor } from '../src/measure.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex').toUpperCase();

const specConfig = () => {
  const levels = levelsFor(9);
  return {
    width: 1440,
    height: 1000,
    seed: 'isopleth-01',
    levels,
    bands: { bandCount: 5, lightenStep: 0.05, contourLevels: levels },
    lighting: true,
    water: { level: 0.3 },
  };
};

test('同参数生成逐字节一致（纯函数）', () => {
  const a = generateTerrainSvg(specConfig());
  const b = generateTerrainSvg(specConfig());
  assert.equal(a.svg, b.svg);
});

test('几何快照：去掉 data-* 元信息后哈希不变', () => {
  const { svg } = generateTerrainSvg(specConfig());
  const geometryOnly = svg.replace(/ data-[a-z-]+="[^"]*"/g, '');
  // 这是几何回归闸门：marching squares / 简化 / 平滑 的任何非预期改动都会被拦下
  assert.equal(
    sha(geometryOnly),
    '37629C20F901BD3A639C556EB4143B2E2D91E2D13E04C76D2B7A35EEEB97CC89',
    '几何哈希变化：确认是有意的改动后再更新此常量',
  );
});

test('不同 seed 产出不同地形', () => {
  const a = generateTerrainSvg({ ...specConfig(), seed: 'isopleth-01' });
  const b = generateTerrainSvg({ ...specConfig(), seed: 'ridge-07' });
  assert.notEqual(sha(a.svg), sha(b.svg));
});

test('层级数、色带级数、编号线符合参数', () => {
  const g = generateTerrainSvg(specConfig());
  assert.equal(g.stats.levels.length, 9);
  assert.equal(g.bands.stats.bands, 5);
  // 每 5 条一条索引线：9 条里只有第 5 条
  assert.equal(g.stats.levels.filter((l) => l.index).length, 1);
  assert.deepEqual(g.bands.bounds, [0.2, 0.4, 0.6, 0.8]);
});

test('渲染需要 PNG 编码器；不给就明确报错而不是静默降级', () => {
  const terrain = buildTerrain(specConfig());
  assert.throws(() => renderSvg(terrain), /encodePng/);
});

test('关掉光照时 renderSvg 不需要编码器', () => {
  const terrain = buildTerrain({ ...specConfig(), lighting: null });
  const svg = renderSvg(terrain);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(!svg.includes('data:image/png'));
});

test('SVG 标签配平、无 NaN/undefined 泄漏', () => {
  const { svg } = generateTerrainSvg(specConfig());
  for (const bad of ['NaN', 'undefined', 'Infinity']) {
    assert.ok(!svg.includes(bad), `产物里出现了 ${bad}`);
  }
  const opens = (svg.match(/<([a-zA-Z]+)(\s|>|\/)/g) ?? []).length;
  const closes = (svg.match(/<\/([a-zA-Z]+)>/g) ?? []).length;
  const selfClosing = (svg.match(/\/>/g) ?? []).length;
  assert.equal(opens, closes + selfClosing, '开合标签数不配平');
});
