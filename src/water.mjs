// 水面层。
//
// 量化表：「水面（可选）`#2b3a3d`，低于 0.3 高度处填充」。
// 规格说明里也写着「没有也能用，有则明显更像地图」。
//
// 几何与色带同一套：把 `h < 0.3` 当做一个区域掩膜跑 marching squares，
// 于是水岸线与 0.3 那条等高线是同一批顶点，不会出现「岸线旁边还飘着一条线」的错位。
// 小环阈值与等高线一致（否则会出现没有对应等高线的小水塘）。
//
// 图层顺序：ground → 色带 → 光照 → **水面** → 等高线。
// 水面压在光照之上是有意的：水面是平的，不该出现山体阴影的明暗。

import { extractBandPolygons } from './marching.mjs';
import { simplify } from './simplify.mjs';
import { catmullRomPath } from './smooth.mjs';
import { TOKENS } from './tokens.mjs';

export const WATER_DEFAULTS = {
  level: 0.3,          // 量化表：低于 0.3 高度
  color: TOKENS.water, // #2b3a3d
  dpTolerance: 0.8,
  minRingExtent: 21,
  opacity: 1,
};

/**
 * @returns {{d:string, rings:number, length:number, stats:object, options:object}}
 */
export function buildWaterLayer(field, config = {}) {
  const c = { ...WATER_DEFAULTS, ...config };
  const { paths, stats } = extractBandPolygons(field, -Infinity, c.level, { minRingExtent: c.minRingExtent });

  let d = '';
  let vertices = 0;
  for (const p of paths) {
    const reduced = simplify(p.points, c.dpTolerance);
    vertices += reduced.length;
    d += catmullRomPath(reduced, true);
  }

  return {
    d,
    rings: paths.length,
    length: stats.totalLength,
    vertices,
    stats,
    options: c,
    layer: { d, fill: c.color, fillOpacity: c.opacity, fillRule: 'evenodd' },
  };
}

/** 视口内（不含外扩区）低于水位的采样点占比，用来和渲染出来的水面像素占比对账。 */
export function waterSampleFraction(field, level) {
  const inset = Math.round(field.pad / field.step);
  let below = 0;
  let total = 0;
  for (let j = inset; j <= field.rows - 1 - inset; j++) {
    const row = j * field.cols;
    for (let i = inset; i <= field.cols - 1 - inset; i++) {
      if (field.data[row + i] < level) below++;
      total++;
    }
  }
  return total ? below / total : 0;
}
