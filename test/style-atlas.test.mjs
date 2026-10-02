import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTerrain, renderSvg } from '../src/generate.mjs';
import { encodePngNode } from '../src/node.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';
import { styleTerrain, STYLE_PRESETS } from '../src/style.mjs';
import { buildAtlasLayers, renderAtlas, ATLAS_DEFAULTS, elevationAt } from '../src/atlas.mjs';

const fullTerrain = () => {
  const levels = levelsFor(9);
  return buildTerrain({
    width: 720,
    height: 480,
    seed: 'isopleth-01',
    levels,
    bands: { bandCount: 5, contourLevels: levels },
    lighting: { normalize: true },
    water: { level: 0.3 },
  });
};

test('三套预设都能出图，且颜色确实不同', () => {
  const t = fullTerrain();
  const out = {};
  for (const name of Object.keys(STYLE_PRESETS)) {
    const svg = renderSvg(styleTerrain(t, name), { encodePng: encodePngNode });
    assert.ok(svg.startsWith('<svg'), `${name} 未产出 SVG`);
    assert.ok(!svg.includes('undefined'), `${name} 产物里有 undefined`);
    out[name] = svg;
  }
  assert.notEqual(out.spec, out.survey);
  assert.notEqual(out.survey, out['survey-water']);
});

test('survey 预设不带水面（地纹语言里非必要），survey-water 带', () => {
  const t = fullTerrain();
  const dry = renderSvg(styleTerrain(t, 'survey'), { encodePng: encodePngNode });
  const wet = renderSvg(styleTerrain(t, 'survey-water'), { encodePng: encodePngNode });
  assert.ok(!dry.includes(STYLE_PRESETS['survey-water'].water), 'survey 不应出现水面色');
  assert.ok(wet.includes(STYLE_PRESETS['survey-water'].water), 'survey-water 应出现水面色');
});

test('styleTerrain 要求归一化明暗，否则明确报错', () => {
  const levels = levelsFor(9);
  const notNormalized = buildTerrain({ width: 320, height: 240, seed: 'x', levels, lighting: true, water: null });
  assert.throws(() => styleTerrain(notNormalized, 'survey'), /归一化/);
});

test('未知预设报错并列出可选值', () => {
  assert.throws(() => styleTerrain(fullTerrain(), 'nope'), /未知风格预设/);
});

test('图层顺序：色带 → 光照 → 水面 → 等高线', () => {
  const kinds = fullTerrain().layers.map((l) => l.kind);
  const first = (k) => kinds.indexOf(k);
  assert.ok(first('band') < first('shade'));
  assert.ok(first('shade') < first('water'));
  assert.ok(first('water') < first('contour'));
});

test('等高线图层带简化后的控制点（分层方案逐段切分要用）', () => {
  for (const l of fullTerrain().layers.filter((x) => x.kind === 'contour')) {
    assert.ok(Array.isArray(l.paths) && l.paths.length > 0);
    assert.ok(l.paths[0].points.length >= 2);
  }
});

test('高程换算：49 层 × 20m，第 5 条正好 100m', () => {
  assert.equal(elevationAt(5 / 50, 49, 20), 100);
  assert.equal(elevationAt(11 / 50, 49, 20), 220);
});

test('分层方案：主线每 5 条、属性线逐段局部出现、标注数量符合参数', () => {
  const levels = levelsFor(ATLAS_DEFAULTS.intervals);
  const terrain = buildTerrain({ width: 960, height: 640, seed: 'isopleth-01', levels, bands: null, lighting: null, water: null });
  const { layers, defs, stats } = buildAtlasLayers(terrain);

  assert.equal(stats.majorLines, Math.floor(ATLAS_DEFAULTS.intervals / 5));
  assert.ok(stats.minorLines > 0);
  // 属性线是「段」不是「整条线」：切开后数量应明显多于被选中的层级数
  const attributed = Math.floor(ATLAS_DEFAULTS.intervals / ATLAS_DEFAULTS.attribute.every);
  assert.ok(stats.warmSegments + stats.coolSegments > 0, '应至少切出一些属性线段');
  assert.ok(stats.warmSegments <= attributed * 8, '段数不应爆炸');
  assert.ok(stats.markers >= 0 && stats.markers <= ATLAS_DEFAULTS.markers.count);

  // defs 三件套：噪点滤镜 / 扫描线图案 / 径向渐变
  for (const id of ['atlas-noise', 'atlas-scan', 'atlas-vignette']) {
    assert.ok(defs.includes(id), `defs 缺少 ${id}`);
  }
  // 混合模式必须显式写出（SVG 原生没有）；叠加层是 raw 标记，所以整串一起查
  const modes = layers.map((l) => l.style ?? l.raw ?? '').join(' ');
  for (const m of ['screen', 'overlay', 'soft-light', 'multiply']) {
    assert.ok(modes.includes(m), `缺少混合模式 ${m}`);
  }
});

test('卡片淡出：给了 rects 才生成蒙版，且被等高线层引用', () => {
  const levels = levelsFor(25);
  const terrain = buildTerrain({ width: 640, height: 480, seed: 'x', levels, bands: null, lighting: null, water: null });

  const without = buildAtlasLayers(terrain);
  assert.ok(!without.defs.includes('card-fade'), '未给 rects 不应生成蒙版');

  const withCards = buildAtlasLayers(terrain, { fade: { rects: [{ x: 100, y: 100, w: 200, h: 120 }] } });
  assert.ok(withCards.defs.includes('card-fade'));
  assert.ok(withCards.layers.some((l) => l.mask === 'card-fade'), '等高线层应引用蒙版');
});

test('分层方案没有光照位图，所以不需要 PNG 编码器', () => {
  const levels = levelsFor(ATLAS_DEFAULTS.intervals);
  const terrain = buildTerrain({ width: 640, height: 480, seed: 'x', levels, bands: null, lighting: null, water: null });
  const { svg } = renderAtlas(terrain);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(!svg.includes('data:image/png'), '分层方案不该出现内嵌位图');
});

test('间距随层数下降（密度可调）', () => {
  const sparse = medianContourSpacing(
    buildTerrain({ width: 720, height: 480, seed: 's', levels: levelsFor(9), framing: 'origin' }).field,
    9,
  ).median;
  const dense = medianContourSpacing(
    buildTerrain({ width: 720, height: 480, seed: 's', levels: levelsFor(36), framing: 'origin' }).field,
    36,
  ).median;
  assert.ok(dense < sparse * 0.5, `36 层应明显比 9 层密: ${dense} vs ${sparse}`);
});
