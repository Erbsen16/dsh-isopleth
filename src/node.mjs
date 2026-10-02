// Node 侧的生成入口：把 zlib 的同步 deflate 注入给平台无关的核心。
//
//   import { generateTerrainSvg } from './node.mjs'
//   const { svg, timings, stats } = generateTerrainSvg({ width, height, seed, levels, bands, lighting, water })

import { deflateSync } from 'node:zlib';
import { pngBytes } from './png.mjs';
import { buildTerrain, renderSvg, GEN_DEFAULTS } from './generate.mjs';

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms

/** 同步 PNG 编码器。 */
export function encodePngNode(width, height, pixels, channels = 1) {
  return pngBytes(width, height, pixels, channels, (raw) => new Uint8Array(deflateSync(raw, { level: 9 })));
}

/** 同步生成 SVG（Node 默认路径）。 */
export function generateTerrainSvg(config = {}) {
  const t0 = now();
  const terrain = buildTerrain(config);
  const t1 = now();
  const svg = renderSvg(terrain, { encodePng: encodePngNode });
  const t2 = now();
  return {
    ...terrain,
    svg,
    timings: { ...terrain.timings, svgMs: t2 - t1, totalMs: t2 - t0 },
  };
}

/** 旧名，保留为别名。 */
export const generateIsolineSvg = generateTerrainSvg;

export { buildTerrain, renderSvg, GEN_DEFAULTS };
