// 生成核心（浏览器安全：本文件不 import 任何宿主 API）。
//
//   buildTerrain(config)            纯计算：高度场 -> 色带 / 光照位图 / 水面 / 等高线
//   renderSvg(terrain, {encodePng}) 组装 SVG；PNG 编码器由调用方注入
//
// Node 侧封装见 src/node.mjs（zlib 同步），浏览器侧见 src/browser.mjs（CompressionStream 异步）。
// 两侧产出同一张图，只是编码器不同。

import { buildField, FIELD_DEFAULTS } from './field.mjs';
import { extractIsolines } from './marching.mjs';
import { buildBandLayers, BAND_DEFAULTS } from './bands.mjs';
import { buildHillshade, SHADE_DEFAULTS } from './hillshade.mjs';
import { buildWaterLayer, WATER_DEFAULTS } from './water.mjs';
import { simplify } from './simplify.mjs';
import { catmullRomPath } from './smooth.mjs';
import { buildSvg, contourLayer, bandLayer } from './svg.mjs';
import { bytesToBase64 } from './png.mjs';

// 平台无关计时：performance 在浏览器与 Node 16+ 都有
const now =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

export const GEN_DEFAULTS = {
  width: 1440,
  height: 1000,
  seed: 'isopleth-01',
  levels: [0.5],
  indexEvery: 5,       // 量化表：每 5 条一条索引线（1.4px）
  dpTolerance: 1.5,
  minPolylineLength: 40,
  minRingExtent: 21,
  bands: null,         // null = 不出色带；true 或 { bandCount, lightenStep, contourLevels }
  lighting: null,      // null = 不出光照；true 或 { azimuthDeg, altitudeDeg, relief, ... }
  water: null,         // null = 不出水面；true 或 { level, color }
  background: undefined, // 底色；不传 = TOKENS.ground（量化表：或跟随主题的 --th-bg）
  field: {},
};

/**
 * 纯计算，不产出字符串。
 * @returns {{width:number,height:number,layers:Array,bands:object|null,shade:object|null,
 *            water:object|null,stats:object,camera:object,timings:object,meta:object}}
 *
 * layers 是有序描述符：{kind:'band'|'shade'|'water'|'contour'}
 * 其中 shade 带原始 RGBA，渲染时才编码成内嵌 PNG。
 */
export function buildTerrain(config = {}) {
  const c = { ...GEN_DEFAULTS, ...config };
  const fieldOpts = { ...FIELD_DEFAULTS, ...(config.field ?? {}) };

  const t0 = now();
  const field = buildField({ width: c.width, height: c.height, seed: c.seed, ...fieldOpts });
  const t1 = now();

  const layers = [];

  // ---- 色带（低层级在下，高层级在上）----
  let bandInfo = null;
  if (c.bands) {
    const b = { ...BAND_DEFAULTS, minRingExtent: c.minRingExtent, ...(c.bands === true ? {} : c.bands) };
    const contourLevels = b.contourLevels ?? c.levels;
    const built = buildBandLayers(field, { ...b, contourLevels });
    bandInfo = {
      bounds: built.bounds,
      stats: built.stats,
      bands: built.bands.map((x) => ({ index: x.index, low: x.low, high: x.high, alpha: x.alpha, rings: x.rings, dLength: x.d.length })),
    };
    for (const band of built.bands) {
      if (band.alpha > 0 && band.d) {
        layers.push({ ...bandLayer(band.d, { alpha: band.alpha }), kind: 'band', alpha: band.alpha });
      }
    }
  }
  const t2 = now();

  // ---- 单向光照（叠在色带之上、等高线之下；水面之上另说）----
  let shadeInfo = null;
  if (c.lighting) {
    const o = { ...SHADE_DEFAULTS, ...(c.lighting === true ? {} : c.lighting) };
    const shade = buildHillshade(field, o);
    layers.push({ kind: 'shade', rgba: shade.rgba, rgbaWidth: shade.width, rgbaHeight: shade.height });
    shadeInfo = { ...shade.stats, options: shade.options };
  }
  const t2b = now();

  // ---- 水面（压在光照之上：水面是平的，不该有山体阴影）----
  let waterInfo = null;
  if (c.water) {
    const w = { ...WATER_DEFAULTS, minRingExtent: c.minRingExtent, ...(c.water === true ? {} : c.water) };
    const water = buildWaterLayer(field, w);
    if (water.d) layers.push({ ...water.layer, kind: 'water' });
    waterInfo = {
      level: water.options.level,
      color: water.options.color,
      rings: water.rings,
      vertices: water.vertices,
      length: water.length,
    };
  }
  const t2c = now();

  // ---- 等高线（画在最上面）----
  const stats = {
    levels: [],
    kept: 0,
    rings: 0,
    open: 0,
    droppedShortOpen: 0,
    droppedSmallRing: 0,
    verticesAfterSimplify: 0,
    controlPoints: 0,
  };

  const ordinalOf = new Map();
  [...c.levels].sort((a, b) => a - b).forEach((level, i) => ordinalOf.set(level, i + 1));

  for (const level of c.levels) {
    const ordinal = ordinalOf.get(level);
    const isIndex = ordinal % c.indexEvery === 0;
    const { paths, stats: s } = extractIsolines(field, level, {
      minPolylineLength: c.minPolylineLength,
      minRingExtent: c.minRingExtent,
    });
    let d = '';
    for (const p of paths) {
      const reduced = simplify(p.points, c.dpTolerance);
      stats.verticesAfterSimplify += reduced.length;
      stats.controlPoints += p.points.length;
      d += catmullRomPath(reduced, p.closed);
    }
    stats.kept += s.kept;
    stats.rings += s.rings;
    stats.open += s.open;
    stats.droppedShortOpen += s.droppedShortOpen;
    stats.droppedSmallRing += s.droppedSmallRing;
    stats.levels.push({ level, ordinal, index: isIndex, ...s, dLength: d.length });
    layers.push({ kind: 'contour', d, level, index: isIndex, ...contourLayer(d, { index: isIndex }) });
  }
  const t3 = now();

  return {
    width: c.width,
    height: c.height,
    background: c.background,
    field,
    layers,
    bands: bandInfo,
    shade: shadeInfo,
    water: waterInfo,
    stats,
    camera: field.camera,
    meta: {
      generator: 'dsh-isopleth',
      step: c.water ? '4' : c.lighting ? '3' : c.bands ? '2' : '1',
      seed: c.seed,
    },
    timings: {
      fieldMs: t1 - t0,
      bandsMs: t2 - t1,
      shadeMs: t2b - t2,
      waterMs: t2c - t2b,
      isolineMs: t3 - t2c,
      geometryMs: t3 - t0,
    },
  };
}

const isThenable = (v) => !!v && typeof v.then === 'function';

/**
 * 组装 SVG。光照位图需要 PNG 编码器：
 *   encodePng(width, height, pixels, channels) -> Uint8Array | Promise<Uint8Array>
 * 返回 string（同步编码器）或 Promise<string>（异步编码器）。
 */
export function renderSvg(terrain, { encodePng } = {}) {
  const assemble = (href) =>
    buildSvg({
      width: terrain.width,
      height: terrain.height,
      background: terrain.background,
      meta: terrain.meta,
      layers: terrain.layers.map((l) => {
        if (l.kind !== 'shade') return l;
        return {
          kind: 'image',
          href,
          x: 0,
          y: 0,
          width: terrain.width,
          height: terrain.height,
        };
      }),
    });

  const shade = terrain.layers.find((l) => l.kind === 'shade');
  if (!shade) return assemble(null);
  if (!encodePng) {
    throw new Error('renderSvg: 传入了光照但没给 encodePng；用 src/node.mjs（Node）或 src/browser.mjs（浏览器），或设 lighting: null');
  }

  const png = encodePng(shade.rgbaWidth, shade.rgbaHeight, shade.rgba, 4);
  const toHref = (bytes) => `data:image/png;base64,${bytesToBase64(bytes)}`;
  return isThenable(png) ? png.then((b) => assemble(toHref(b))) : assemble(toHref(png));
}
