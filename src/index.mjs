// 公开 API（浏览器安全）。
//
//   import { levelsFor, createTerrainTexture, buildTerrain } from 'dsh-isopleth'
//
// 纯几何 / 纯计算的部分同步可用；需要内嵌光照位图时走 createTerrainTexture（异步）。

export { TOKENS, STROKE, SPACING_BAND } from './tokens.mjs';
export { levelsFor, medianContourSpacing } from './measure.mjs';
export { buildField, FIELD_DEFAULTS, sampleField } from './field.mjs';
export { buildTerrain, renderSvg, GEN_DEFAULTS } from './generate.mjs';
export { BAND_DEFAULTS, bandBoundaryLevels } from './bands.mjs';
export { SHADE_DEFAULTS } from './hillshade.mjs';
export { WATER_DEFAULTS } from './water.mjs';
export { pngBytes, bytesToBase64 } from './png.mjs';
export {
  createTerrainTexture,
  terrainBackgroundCss,
  encodePngBrowser,
  fullTerrainConfig,
} from './browser.mjs';
