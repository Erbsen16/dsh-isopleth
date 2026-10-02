// 分级色带（hypsometric bands）。
//
// 量化表：「色带填充 5~7 级，每级比下一级亮 3%~5%（低透明度白叠加）」。
// 算法规格：「按层级填充闭合环（低层级在下、高层级在上），形成分级色带；等高线画在填充之上」。
//
// 两处层数不一致（等高线 9 条 / 色带 5~7 级）的调和方式：**色带边界必须是等高线层级的一个子集**，
// 这样每条色带边界上正好压着一条等高线，色带接缝被线条盖住，填充边缘与线绝不漂移。

import { extractBandPolygons } from './marching.mjs';
import { simplify } from './simplify.mjs';
import { catmullRomPath } from './smooth.mjs';

export const BAND_DEFAULTS = {
  bandCount: 5,          // 量化表 5~7 级
  lightenStep: 0.05,     // 每级白叠加 3%~5%，取带上沿 5%（细淡反馈）
  dpTolerance: 0.8,      // 比等高线更小的容差，避免填充边缘离线
  // 必须与等高线的 minRingExtent 一致：等高线会丢掉的小环，色带也必须丢，
  // 否则会出现“有色带边界但没有等高线”的孤块（填充与线条不一致）。
  minRingExtent: 21,
  fillColor: '#ffffff',
};

/**
 * 从等高线层级里挑出 bandCount-1 条色带边界，尽量均匀。
 * n=9、bandCount=5 时落在 0.2 / 0.4 / 0.6 / 0.8。
 */
export function bandBoundaryLevels(contourLevels, bandCount) {
  const n = contourLevels.length;
  const out = [];
  for (let i = 1; i < bandCount; i++) {
    const idx = Math.round((i * (n + 1)) / bandCount) - 1;
    out.push(contourLevels[Math.max(0, Math.min(n - 1, idx))]);
  }
  return [...new Set(out)];
}

/**
 * @returns {{bands:Array, bounds:number[], stats:object}}
 */
export function buildBandLayers(field, config = {}) {
  const c = { ...BAND_DEFAULTS, ...config };
  const bounds = bandBoundaryLevels(c.contourLevels, c.bandCount);
  const edges = [-Infinity, ...bounds, Infinity];

  const bands = [];
  const stats = { bands: 0, rings: 0, vertices: 0, overlaySteps: [] };

  for (let k = 0; k < edges.length - 1; k++) {
    const low = edges[k];
    const high = edges[k + 1];
    const { paths, stats: s } = extractBandPolygons(field, low, high, { minRingExtent: c.minRingExtent });

    let d = '';
    for (const p of paths) {
      const reduced = simplify(p.points, c.dpTolerance);
      stats.vertices += reduced.length;
      d += catmullRomPath(reduced, true);
    }

    const alpha = +(k * c.lightenStep).toFixed(4);
    stats.rings += s.kept;
    stats.bands++;
    stats.overlaySteps.push(alpha);

    bands.push({
      index: k,
      low,
      high,
      d,
      rings: s.kept,
      length: s.totalLength,
      alpha,
      fill: c.fillColor,
    });
  }

  return { bands, bounds, stats };
}
