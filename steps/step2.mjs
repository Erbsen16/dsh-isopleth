// Step 2 CLI: 分级色带填充 + 等高线，静态 SVG（+ PNG 预览）。
//
//   node steps/step2.mjs                                   # 默认 seed / 三尺寸 / 白叠加 4%
//   node steps/step2.mjs --seed ridge-07 --lighten 0.05
//   node steps/step2.mjs --variants 1                      # 再出 3%/4%/5% 三档对比裁切
//
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateTerrainSvg } from '../src/generate.mjs';
import { BAND_DEFAULTS } from '../src/bands.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';
import { SPACING_BAND } from '../src/tokens.mjs';
import { encodePng } from '../tools/png.mjs';
import { decodePng, measureTones, toneLadder, rgbToHex } from '../tools/png-read.mjs';
import { rasterizeSvg } from '../tools/rasterize.mjs';
import { TOKENS } from '../src/tokens.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const seed = argOf('seed', 'isopleth-01');
const LEVEL_COUNT = Number(argOf('levels', '9'));
const BAND_COUNT = Number(argOf('bands', String(BAND_DEFAULTS.bandCount)));
const LIGHTEN = Number(argOf('lighten', String(BAND_DEFAULTS.lightenStep)));
const PREVIEW = argOf('preview', '1') !== '0';
const VARIANTS = argOf('variants', '0') === '1';
const CROP = { x: 180, y: 280, w: 720, h: 460 };

const sizes = argOf('sizes', '1440x1000,2560x1440,390x844')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [w, h] = s.split('x').map(Number);
    return { w, h };
  });

const levels = levelsFor(LEVEL_COUNT);

function cropFrom(pngPath, outPath) {
  const src = decodePng(readFileSync(pngPath));
  const buf = Buffer.alloc(CROP.w * CROP.h * 3);
  for (let y = 0; y < CROP.h; y++) {
    for (let x = 0; x < CROP.w; x++) {
      const s = ((y + CROP.y) * src.width + (x + CROP.x)) * src.channels;
      const d = (y * CROP.w + x) * 3;
      buf[d] = src.data[s];
      buf[d + 1] = src.data[s + 1];
      buf[d + 2] = src.data[s + 2];
    }
  }
  writeFileSync(outPath, encodePng(CROP.w, CROP.h, buf, 3));
  return outPath;
}

const report = { step: 2, seed, levels: LEVEL_COUNT, bandCount: BAND_COUNT, lighten: LIGHTEN, sizes: [] };

for (const { w, h } of sizes) {
  const dir = join(OUT, `step2-${seed}`);
  mkdirSync(dir, { recursive: true });

  const gen = generateTerrainSvg({
    width: w, height: h, seed, levels,
    bands: { bandCount: BAND_COUNT, lightenStep: LIGHTEN, contourLevels: levels },
  });

  const svgPath = join(dir, `terrain-${w}x${h}.svg`);
  writeFileSync(svgPath, gen.svg, 'utf8');

  let png = null;
  let crop = null;
  let dpr2 = null;
  let lineStats = null;
  if (PREVIEW) {
    png = rasterizeSvg(svgPath, join(dir, `terrain-${w}x${h}.png`), w, h);
    if (w === 1440) {
      crop = cropFrom(png, join(dir, `crop1to1-${w}x${h}.png`));
      dpr2 = rasterizeSvg(svgPath, join(dir, `terrain-${w}x${h}@2x.png`), w, h, { dpr: 2 });
      lineStats = measureTones(png, TOKENS.ground, LIGHTEN, BAND_COUNT);
    }
  }

  const spacing = medianContourSpacing(gen.field, LEVEL_COUNT);
  const bytes = statSync(svgPath).size;

  report.sizes.push({
    size: `${w}x${h}`,
    svg: svgPath,
    svgKB: +(bytes / 1024).toFixed(1),
    field: { min: +gen.field.min.toFixed(3), max: +gen.field.max.toFixed(3), samples: gen.field.cols * gen.field.rows },
    bands: gen.bands,
    isolines: { kept: gen.stats.kept, rings: gen.stats.rings, open: gen.stats.open, vertices: gen.stats.verticesAfterSimplify },
    spacing: {
      median: spacing.median === null ? null : +spacing.median.toFixed(1),
      p10: spacing.p10 === null ? null : +spacing.p10.toFixed(1),
      p90: spacing.p90 === null ? null : +spacing.p90.toFixed(1),
      inBand: spacing.median !== null && spacing.median >= SPACING_BAND.min && spacing.median <= SPACING_BAND.max,
    },
    timings: Object.fromEntries(Object.entries(gen.timings).map(([k, v]) => [k, +v.toFixed(1)])),
    lineOnBandStats: lineStats,
    tones: lineStats,    preview: png,
    crop,
    dpr2,
  });
}

// 3% / 4% / 5% 白叠加三档对比
if (VARIANTS) {
  const dir = join(OUT, 'step2-variants');
  mkdirSync(dir, { recursive: true });
  report.variants = [];
  for (const step of [0.03, 0.04, 0.05]) {
    const gen = generateTerrainSvg({
      width: 1440, height: 1000, seed, levels,
      bands: { bandCount: BAND_COUNT, lightenStep: step, contourLevels: levels },
    });
    const svgPath = join(dir, `terrain-lighten${String(step).replace('.', '')}.svg`);
    writeFileSync(svgPath, gen.svg, 'utf8');
    const png = rasterizeSvg(svgPath, join(dir, `terrain-lighten${String(step).replace('.', '')}.png`), 1440, 1000);
    const crop = cropFrom(png, join(dir, `crop-lighten${String(step).replace('.', '')}.png`));
    report.variants.push({
      lightenStep: step,
      svgKB: +(statSync(svgPath).size / 1024).toFixed(1),
      brightestBandHex: gen.bands ? brightHex(step, BAND_COUNT - 1) : null,
      svg: svgPath,
      png,
      crop,
    });
  }
}

function brightHex(step, levels) {
  const base = [0x14, 0x17, 0x1a];
  const a = step * levels;
  const mix = base.map((v) => Math.round(v + (255 - v) * a));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const reportPath = join(OUT, `step2-report-${seed}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`report -> ${reportPath}`);
for (const s of report.sizes) {
  console.log(
    [
      s.size.padEnd(10),
      `bands ${s.bands.stats.bands} (bounds ${s.bands.bounds.join('/')})`,
      `alpha ${s.bands.stats.overlaySteps.join('/')}`,
      `field ${s.timings.fieldMs}ms`,
      `bands ${s.timings.bandsMs}ms`,
      `iso ${s.timings.isolineMs}ms`,
      `total ${s.timings.totalMs}ms`,
      `svg ${s.svgKB}KB`,
      `gap ${s.spacing.median}px inBand=${s.spacing.inBand}`,
      s.tones ? `tones ${s.tones.bandPixelPercent.join('/')}% other ${s.tones.otherPercent}%` : '',
    ].join(' | '),
  );
}
