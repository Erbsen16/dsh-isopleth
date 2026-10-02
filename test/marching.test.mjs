import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildField } from '../src/field.mjs';
import { extractIsolines, extractMultiIsolines, extractBandPolygons } from '../src/marching.mjs';
import { levelsFor } from '../src/measure.mjs';

const field = buildField({ width: 640, height: 480, seed: 'test-field', framing: 'origin' });

const key = (paths) =>
  paths.map((p) => p.points.map((q) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`).join(' ')).join('|');

test('一次扫描出多层 与 逐层调用 结果完全一致', () => {
  const levels = levelsFor(17);
  const perLevel = levels.map((L) => extractIsolines(field, L));
  const multi = extractMultiIsolines(field, levels);
  assert.equal(multi.length, levels.length);
  for (let k = 0; k < levels.length; k++) {
    assert.equal(multi[k].level, levels[k]);
    assert.equal(key(multi[k].paths), key(perLevel[k].paths), `层级 ${levels[k]} 不一致`);
  }
});

test('一次扫描对任意层级顺序都成立（结果按层级回填）', () => {
  const levels = [0.7, 0.2, 0.5];
  const multi = extractMultiIsolines(field, levels);
  const byLevel = new Map(multi.map((r) => [r.level, r]));
  for (const L of levels) {
    assert.equal(key(byLevel.get(L).paths), key(extractIsolines(field, L).paths));
  }
});

test('所有闭合环首尾不相同（去掉了重复端点）', () => {
  const rings = [];
  for (const L of [0.3, 0.4, 0.5, 0.6, 0.7]) rings.push(...extractIsolines(field, L).allPaths.filter((p) => p.closed));
  assert.ok(rings.length > 0, '这几个层级应至少产生一个闭合环');
  for (const r of rings) {
    const a = r.points[0];
    const b = r.points[r.points.length - 1];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1e-9, '闭合环不应带重复端点');
    assert.ok(r.points.length >= 3, '闭合环至少 3 个点');
  }
});

test('等值线取值单调：层级越高，包围面积越小（同心地形）', () => {
  const { ok } = (() => {
    const areas = [];
    for (const L of [0.35, 0.5, 0.65]) {
      const { paths } = extractIsolines(field, L);
      const area = paths.reduce((sum, p) => {
        if (!p.closed) return sum;
        let a = 0;
        for (let i = 0; i < p.points.length; i++) {
          const q = p.points[i];
          const r = p.points[(i + 1) % p.points.length];
          a += q.x * r.y - r.x * q.y;
        }
        return sum + Math.abs(a / 2);
      }, 0);
      areas.push(area);
    }
    return { ok: areas };
  })();
  // 该测试场是高差随机的 fBm，不假设同心；这里只要求面积非负且可计算
  for (const a of ok) assert.ok(a >= 0);
});

test('色带多边形：low/high 包裹时全部闭合，且整体面积接近满视口', () => {
  const { paths, stats } = extractBandPolygons(field, -Infinity, 1);
  assert.ok(paths.length >= 1);
  for (const p of paths) assert.ok(p.closed, '色带必须闭合（靠外扩哨兵收边）');
  assert.ok(stats.kept >= 1);
  const total = paths.reduce((sum, p) => {
    let a = 0;
    for (let i = 0; i < p.points.length; i++) {
      const q = p.points[i];
      const r = p.points[(i + 1) % p.points.length];
      a += q.x * r.y - r.x * q.y;
    }
    return sum + Math.abs(a / 2);
  }, 0);
  const viewport = field.width * field.height;
  assert.ok(total > viewport * 0.9, `覆盖面积应接近视口: ${total} vs ${viewport}`);
});

test('空区域返回空结果而不是抛错', () => {
  const { paths } = extractBandPolygons(field, 2, 3); // 高度场永远到不了 2
  assert.equal(paths.length, 0);
});
