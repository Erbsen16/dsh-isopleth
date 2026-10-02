// 浏览器侧的生成入口：PNG 编码走 CompressionStream，**不含任何 Node API**。
//
//   import { createTerrainTexture } from './browser.mjs'
//   const svg = await createTerrainTexture({ width: 1440, height: 1000, seed: 'isopleth-01',
//                                            levels: levelsFor(9), bands: true, lighting: true, water: true })

import { pngBytes } from './png.mjs';
import { buildTerrain, renderSvg } from './generate.mjs';
import { levelsFor } from './measure.mjs';

/** 异步 PNG 编码器（CompressionStream 产出 zlib 流，正好是 PNG IDAT 需要的格式）。 */
export function encodePngBrowser(width, height, pixels, channels = 1) {
  return pngBytes(width, height, pixels, channels, async (raw) => {
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  });
}

/** 默认一套「完整地形」参数。 */
export function fullTerrainConfig(config = {}) {
  const levels = config.levels ?? levelsFor(9);
  return { levels, bands: true, lighting: true, water: true, ...config, levels };
}

/** @returns {Promise<string>} SVG 字符串 */
export function createTerrainTexture(config = {}) {
  const terrain = buildTerrain(fullTerrainConfig(config));
  return Promise.resolve(renderSvg(terrain, { encodePng: encodePngBrowser })).then((svg) => svg);
}

/** 直接可用的 CSS 背景值。 */
export async function terrainBackgroundCss(config = {}) {
  const svg = await createTerrainTexture(config);
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

export { levelsFor };
