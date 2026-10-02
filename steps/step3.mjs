// Step 3 CLI: 分级色带 + 单向光照 + 等高线，静态 SVG（+ PNG 预览）。
//
//   node steps/step3.mjs                                  # 默认 seed / 三尺寸 / 左上 45° 打光
//   node steps/step3.mjs --azimuth 315 --relief 620 --shadow 0.34 --light 0.18
//   node steps/step3.mjs --variants 1                     # 关灯 / 开灯 / 加强 三档对比裁切
//
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateTerrainSvg } from '../src/node.mjs';
import { BAND_DEFAULTS } from '../src/bands.mjs';
import { SHADE_DEFAULTS } from '../src/hillshade.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';
import { SPACING_BAND, TOKENS } from '../src/tokens.mjs';
import { measureTones } from '../tools/png-read.mjs';
import { rasterizeSvg } from '../tools/rasterize.mjs';
import { argOf, parseSizes, cropFrom } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');

const args = process.argv.slice(2);
const seed = argOf(args, 'seed', 'isopleth-01');
const LEVEL_COUNT = Number(argOf(args, 'levels', '9'));
const BAND_COUNT = Number(argOf(args, 'bands', String(BAND_DEFAULTS.bandCount)));
const LIGHTEN = Number(argOf(args, 'lighten', String(BAND_DEFAULTS.lightenStep)));
const AZIMUTH = Number(argOf(args, 'azimuth', String(SHADE_DEFAULTS.azimuthDeg)));
const ALTITUDE = Number(argOf(args, 'altitude', String(SHADE_DEFAULTS.altitudeDeg)));
const RELIEF = Number(argOf(args, 'relief', String(SHADE_DEFAULTS.relief)));
const SHADOW = Number(argOf(args, 'shadow', String(SHADE_DEFAULTS.shadowAlpha)));
const LIGHT = Number(argOf(args, 'light', String(SHADE_DEFAULTS.lightAlpha)));
const PREVIEW = argOf(args, 'preview', '1') !== '0';
const VARIANTS = argOf(args, 'variants', '0') === '1';

const CROP = { x: 180, y: 280, w: 720, h: 460 };
const sizes = parseSizes(argOf(args, 'sizes', '1440x1000,2560x1440,390x844'));
const levels = levelsFor(LEVEL_COUNT);

const lighting = {
  azimuthDeg: AZIMUTH,
  altitudeDeg: ALTITUDE,
  relief: RELIEF,
  shadowAlpha: SHADOW,
  lightAlpha: LIGHT,
};

const report = { step: 3, seed, levels: LEVEL_COUNT, bandCount: BAND_COUNT, lighten: LIGHTEN, lighting, sizes: [] };

for (const { w, h } of sizes) {
  const dir = join(OUT, `step3-${seed}`);
  mkdirSync(dir, { recursive: true });

  const gen = generateTerrainSvg({
    width: w, height: h, seed, levels,
    bands: { bandCount: BAND_COUNT, lightenStep: LIGHTEN, contourLevels: levels },
    lighting,
  });

  const svgPath = join(dir, `terrain-${w}x${h}.svg`);
  writeFileSync(svgPath, gen.svg, 'utf8');

  let crop = null;
  let dpr2 = null;
  let tones = null;
  if (PREVIEW) {
    const png = rasterizeSvg(svgPath, join(dir, `terrain-${w}x${h}.png`), w, h);
    if (w === 1440) {
      crop = cropFrom(png, join(dir, `crop1to1-${w}x${h}.png`), CROP);
      dpr2 = rasterizeSvg(svgPath, join(dir, `terrain-${w}x${h}@2x.png`), w, h, { dpr: 2 });
      tones = measureTones(png, TOKENS.ground, LIGHTEN, BAND_COUNT, 6);
    }
  }

  const spacing = medianContourSpacing(gen.field, LEVEL_COUNT);
  report.sizes.push({
    size: `${w}x${h}`,
    svg: svgPath,
    crop,
    dpr2,
    svgKB: +(statSync(svgPath).size / 1024).toFixed(1),
    shadeKB: gen.shade ? +(gen.shade.base64Bytes / 1024).toFixed(1) : 0,
    shadePngKB: gen.shade ? +(gen.shade.pngBytes / 1024).toFixed(1) : 0,
    bands: gen.bands,
    shade: gen.shade,
    spacing: {
      median: spacing.median === null ? null : +spacing.median.toFixed(1),
      p10: +spacing.p10.toFixed(1),
      p90: +spacing.p90.toFixed(1),
      inBand: spacing.median >= SPACING_BAND.min && spacing.median <= SPACING_BAND.max,
    },
    timings: Object.fromEntries(Object.entries(gen.timings).map(([k, v]) => [k, +v.toFixed(1)])),
    tones,
  });
}

// 关灯 / 开灯 / 加强 三档对比
if (VARIANTS) {
  const dir = join(OUT, 'step3-variants');
  mkdirSync(dir, { recursive: true });
  report.variants = [];
  const cases = [
    { name: 'nolight', lighting: null },
    { name: 'shade-only', lighting },
    { name: 'shade-and-light', lighting: { ...lighting, lightAlpha: 0.14 } },
    { name: 'shade-strong', lighting: { ...lighting, shadowAlpha: 0.45 } },
    { name: 'shade-mottle', lighting: { ...lighting, gradientRadiusPx: 12 } },
  ];
  for (const c of cases) {
    const gen = generateTerrainSvg({
      width: 1440, height: 1000, seed, levels,
      bands: { bandCount: BAND_COUNT, lightenStep: LIGHTEN, contourLevels: levels },
      lighting: c.lighting,
    });
    const svgPath = join(dir, `${c.name}.svg`);
    writeFileSync(svgPath, gen.svg, 'utf8');
    const png = rasterizeSvg(svgPath, join(dir, `${c.name}.png`), 1440, 1000);
    const crop = cropFrom(png, join(dir, `crop-${c.name}.png`), CROP);
    report.variants.push({ name: c.name, svgKB: +(statSync(svgPath).size / 1024).toFixed(1), svg: svgPath, png, crop });
  }
}

const reportPath = join(OUT, `step3-report-${seed}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`report -> ${reportPath}`);
for (const s of report.sizes) {
  console.log(
    [
      s.size.padEnd(10),
      `svg ${s.svgKB}KB (含明暗位图 ${s.shadeKB}KB base64)`,
      `field ${s.timings.fieldMs}`,
      `bands ${s.timings.bandsMs}`,
      `shade ${s.timings.shadeMs}`,
      `iso ${s.timings.isolineMs}`,
      `total ${s.timings.totalMs}ms`,
      `gap ${s.spacing.median}px`,
      s.shade ? `影/光 ${s.shade.shadowPixelPercent}/${s.shade.lightPixelPercent}% maxα ${s.shade.maxShadowAlpha}/${s.shade.maxLightAlpha}` : '',
    ].join(' | '),
  );
}
