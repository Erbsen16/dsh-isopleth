// 生成核心。
//
// Step 1：高度场 + 单层等值线。
// Step 2：再叠 5~7 级分级色带（低层级在下），等高线画在填充之上。
// 后续步骤（光照 / 水面）会挂在同一条链路上。

import { buildField, FIELD_DEFAULTS } from './field.mjs';
import { extractIsolines } from './marching.mjs';
import { buildBandLayers, BAND_DEFAULTS } from './bands.mjs';
import { buildHillshade, hillshadeDataUri, SHADE_DEFAULTS } from './hillshade.mjs';
import { buildWaterLayer, WATER_DEFAULTS } from './water.mjs';
import { simplify } from './simplify.mjs';
import { catmullRomPath } from './smooth.mjs';
import { buildSvg, contourLayer, bandLayer } from './svg.mjs';

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms

export const GEN_DEFAULTS = {
  width: 1440,
  height: 1000,
  seed: 'isopleth-01',
  levels: [0.5],
  indexEvery: 5,       // 量化表：每 5 条一条索引线（1.4px）
  dpTolerance: 1.5,
  minPolylineLength: 40,
  minRingExtent: 21,
  bands: null,         // null = 不出色带；{ bandCount, lightenStep, contourLevels }
  lighting: null,      // null = 不出光照；true 或 { azimuthDeg, altitudeDeg, relief, ... }
  water: null,         // null = 不出水面；true 或 { level, color }
  field: {},
};

/**
 * @returns {{svg:string, field:object, layers:Array, stats:object, bands:object|null,
 *            camera:object, timings:object}}
 */
export function generateTerrainSvg(config = {}) {
  const c = { ...GEN_DEFAULTS, ...config };
  const fieldOpts = { ...FIELD_DEFAULTS, ...(config.field ?? {}) };

  const t0 = now();
  const field = buildField({ width: c.width, height: c.height, seed: c.seed, ...fieldOpts });
  const t1 = now();

  const layers = [];

  // ---- 色带（先画：低层级在下，高层级在上）----
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
      if (band.alpha > 0 && band.d) layers.push(bandLayer(band.d, { alpha: band.alpha }));
    }
  }
  const t2 = now();

  // ---- 单向光照（叠在色带之上、等高线之下）----
  let shadeInfo = null;
  if (c.lighting) {
    const o = { ...SHADE_DEFAULTS, ...(c.lighting === true ? {} : c.lighting) };
    const shade = buildHillshade(field, o);
    const uri = hillshadeDataUri(shade);
    layers.push({ kind: 'image', href: uri.href, x: 0, y: 0, width: c.width, height: c.height });
    shadeInfo = { ...shade.stats, options: shade.options, pngBytes: uri.pngBytes, base64Bytes: uri.base64Bytes };
  }
  const t2b = now();

  // ---- 水面（压在光照之上：水面是平的，不该有山体阴影）----
  let waterInfo = null;
  if (c.water) {
    const w = { ...WATER_DEFAULTS, minRingExtent: c.minRingExtent, ...(c.water === true ? {} : c.water) };
    const water = buildWaterLayer(field, w);
    if (water.d) layers.push(water.layer);
    waterInfo = {
      level: water.options.level,
      color: water.options.color,
      rings: water.rings,
      vertices: water.vertices,
      length: water.length,
    };
  }
  const t2c = now();

  // ---- 等高线（画在填充与光照之上）----
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
    layers.push({ d, level, kind: isIndex ? 'index-contour' : 'contour', ...contourLayer(d, { index: isIndex }) });
  }
  const t3 = now();

  const svg = buildSvg({
    width: c.width,
    height: c.height,
    layers,
    meta: {
      generator: 'dsh-isopleth',
      step: c.water ? '4' : c.lighting ? '3' : c.bands ? '2' : '1',
      seed: c.seed,
    },
  });
  const t4 = now();

  return {
    svg,
    field,
    layers,
    stats,
    bands: bandInfo,
    shade: shadeInfo,
    water: waterInfo,
    camera: field.camera,
    timings: {
      fieldMs: t1 - t0,
      bandsMs: t2 - t1,
      shadeMs: t2b - t2,
      waterMs: t2c - t2b,
      isolineMs: t3 - t2c,
      svgMs: t4 - t3,
      totalMs: t4 - t0,
    },
  };
}

/** Step 1 时期的名字，保留为别名。 */
export const generateIsolineSvg = generateTerrainSvg;
