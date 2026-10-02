// Step 4 CLI: 完整链路 —— 分级色带 + 单向光照 + 水面 + 等高线。
//
//   node steps/step4.mjs                      # 默认 seed / 三尺寸
//   node steps/step4.mjs --seed ridge-07
//   node steps/step4.mjs --variants 1         # 无水面 / 有水面 / 阈值 0.2 / 0.4 对比
//
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateTerrainSvg } from '../src/node.mjs';
import { BAND_DEFAULTS } from '../src/bands.mjs';
import { SHADE_DEFAULTS } from '../src/hillshade.mjs';
import { WATER_DEFAULTS, waterSampleFraction } from '../src/water.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';
import { SPACING_BAND, TOKENS, STROKE } from '../src/tokens.mjs';
import { decodePng } from '../tools/png-read.mjs';
import { rasterizeSvg } from '../tools/rasterize.mjs';
import { argOf, parseSizes, cropFrom } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');

const args = process.argv.slice(2);
const seed = argOf(args, 'seed', 'isopleth-01');
const LEVEL_COUNT = Number(argOf(args, 'levels', '9'));
const BAND_COUNT = Number(argOf(args, 'bands', String(BAND_DEFAULTS.bandCount)));
const LIGHTEN = Number(argOf(args, 'lighten', String(BAND_DEFAULTS.lightenStep)));
const WATER_LEVEL = Number(argOf(args, 'waterLevel', String(WATER_DEFAULTS.level)));
const PREVIEW = argOf(args, 'preview', '1') !== '0';
const VARIANTS = argOf(args, 'variants', '0') === '1';
const CROP = { x: 180, y: 280, w: 720, h: 460 };

const sizes = parseSizes(argOf(args, 'sizes', '1440x1000,2560x1440,390x844'));
const levels = levelsFor(LEVEL_COUNT);

const config = {
  bands: { bandCount: BAND_COUNT, lightenStep: LIGHTEN, contourLevels: levels },
  lighting: true,
  water: { level: WATER_LEVEL },
};

/** 把渲染图里接近水色的像素占比算出来，和高度场解析值对账。 */
function waterPixelFraction(pngPath, hex, tol = 6) {
  const img = decodePng(readFileSync(pngPath));
  const h = hex.replace('#', '');
  const t = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  let hit = 0;
  for (let i = 0; i < img.data.length; i += img.channels) {
    if (
      Math.abs(img.data[i] - t[0]) <= tol &&
      Math.abs(img.data[i + 1] - t[1]) <= tol &&
      Math.abs(img.data[i + 2] - t[2]) <= tol
    ) hit++;
  }
  return +((hit / (img.data.length / img.channels)) * 100).toFixed(2);
}

const report = { step: 4, seed, levels: LEVEL_COUNT, bandCount: BAND_COUNT, lighten: LIGHTEN, waterLevel: WATER_LEVEL, sizes: [] };

for (const { w, h } of sizes) {
  const dir = join(OUT, `step4-${seed}`);
  mkdirSync(dir, { recursive: true });

  const gen = generateTerrainSvg({ width: w, height: h, seed, levels, ...config });
  const svgPath = join(dir, `terrain-${w}x${h}.svg`);
  writeFileSync(svgPath, gen.svg, 'utf8');

  let crop = null;
  let dpr2 = null;
  let waterPixels = null;
  if (PREVIEW) {
    const png = rasterizeSvg(svgPath, join(dir, `terrain-${w}x${h}.png`), w, h);
    if (w === 1440) {
      crop = cropFrom(png, join(dir, `crop1to1-${w}x${h}.png`), CROP);
      dpr2 = rasterizeSvg(svgPath, join(dir, `terrain-${w}x${h}@2x.png`), w, h, { dpr: 2 });
    }
    waterPixels = waterPixelFraction(png, TOKENS.water);
  }

  const spacing = medianContourSpacing(gen.field, LEVEL_COUNT);
  report.sizes.push({
    size: `${w}x${h}`,
    svg: svgPath,
    crop,
    dpr2,
    svgKB: +(statSync(svgPath).size / 1024).toFixed(1),
    shadeKB: gen.shade ? +(gen.shade.base64Bytes / 1024).toFixed(1) : 0,
    bands: gen.bands,
    shade: gen.shade,
    water: gen.water,
    waterSamplePercent: +(waterSampleFraction(gen.field, WATER_LEVEL) * 100).toFixed(2),
    waterPixelPercent: waterPixels,
    spacing: {
      median: spacing.median === null ? null : +spacing.median.toFixed(1),
      p10: +spacing.p10.toFixed(1),
      p90: +spacing.p90.toFixed(1),
      inBand: spacing.median >= SPACING_BAND.min && spacing.median <= SPACING_BAND.max,
    },
    timings: Object.fromEntries(Object.entries(gen.timings).map(([k, v]) => [k, +v.toFixed(1)])),
    tokens: {
      ground: TOKENS.ground,
      contour: TOKENS.contour,
      contourOpacity: TOKENS.contourOpacity,
      strokeWidth: STROKE.contour,
      indexStrokeWidth: STROKE.indexContour,
      water: TOKENS.water,
      bandOverlayStep: LIGHTEN,
    },
  });
}

if (VARIANTS) {
  const dir = join(OUT, 'step4-variants');
  mkdirSync(dir, { recursive: true });
  report.variants = [];
  const cases = [
    { name: 'nowater', config: { ...config, water: null } },
    { name: 'water-0.30', config },
    { name: 'water-0.20', config: { ...config, water: { level: 0.2 } } },
    { name: 'water-0.40', config: { ...config, water: { level: 0.4 } } },
  ];
  for (const c of cases) {
    const gen = generateTerrainSvg({ width: 1440, height: 1000, seed, levels, ...c.config });
    const svgPath = join(dir, `${c.name}.svg`);
    writeFileSync(svgPath, gen.svg, 'utf8');
    const png = rasterizeSvg(svgPath, join(dir, `${c.name}.png`), 1440, 1000);
    const crop = cropFrom(png, join(dir, `crop-${c.name}.png`), CROP);
    report.variants.push({ name: c.name, svgKB: +(statSync(svgPath).size / 1024).toFixed(1), svg: svgPath, png, crop });
  }
}

const reportPath = join(OUT, `step4-report-${seed}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`report -> ${reportPath}`);
for (const s of report.sizes) {
  console.log(
    [
      s.size.padEnd(10),
      `svg ${s.svgKB}KB`,
      `field ${s.timings.fieldMs}`,
      `bands ${s.timings.bandsMs}`,
      `shade ${s.timings.shadeMs}`,
      `water ${s.timings.waterMs}`,
      `iso ${s.timings.isolineMs}`,
      `total ${s.timings.totalMs}ms`,
      `gap ${s.spacing.median}px`,
      `水面 采样 ${s.waterSamplePercent}% / 像素 ${s.waterPixelPercent}%`,
      `水位线 ${s.water.rings} 环`,
    ].join(' | '),
  );
}
