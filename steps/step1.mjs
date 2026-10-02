// Step 1 CLI: height field + ONE isoline level, static SVG (+ PNG preview).
//
//   node steps/step1.mjs                       # default sizes, seed isopleth-01
//   node steps/step1.mjs --seed ridge-07 --sizes 1440x1000
//
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateIsolineSvg } from '../src/node.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';
import { SPACING_BAND } from '../src/tokens.mjs';
import { encodePng } from '../tools/png.mjs';
import { decodePng } from '../tools/png-read.mjs';
import { rasterizeSvg } from '../tools/rasterize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const seed = argOf('seed', 'isopleth-01');
const sizes = argOf('sizes', '1440x1000,390x844')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [w, h] = s.split('x').map(Number);
    return { w, h };
  });

const LEVEL = Number(argOf('level', '0.5'));
const LEVEL_COUNT = Number(argOf('levels', '9'));
const PREVIEW = argOf('preview', '1') !== '0';
const SHEET = argOf('sheet', '0') === '1';
const DPR2 = argOf('dpr2', '0') === '1';

mkdirSync(OUT, { recursive: true });

const report = { step: 1, seed, level: LEVEL, sizes: [] };

for (const { w, h } of sizes) {
  const dir = join(OUT, `step1-${seed}`);
  mkdirSync(dir, { recursive: true });

  const gen = generateIsolineSvg({ width: w, height: h, seed, levels: [LEVEL] });
  const svgPath = join(dir, `isoline-${w}x${h}.svg`);
  writeFileSync(svgPath, gen.svg, 'utf8');

  let pngPath = null;
  if (PREVIEW) {
    pngPath = rasterizeSvg(svgPath, join(dir, `isoline-${w}x${h}.png`), w, h);
  }

  // Height-field proof image (grayscale, half resolution) + measured spacing.
  const f = gen.field;
  const fw = Math.round(f.cols / 2);
  const fh = Math.round(f.rows / 2);
  const gray = new Uint8Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const v = f.data[Math.min(f.rows - 1, y * 2) * f.cols + Math.min(f.cols - 1, x * 2)];
      gray[y * fw + x] = Math.round(v * 255);
    }
  }
  const fieldPng = join(dir, `heightfield-${w}x${h}.png`);
  writeFileSync(fieldPng, encodePng(fw, fh, gray, 1));

  const spacing = medianContourSpacing(f, LEVEL_COUNT);
  const bytes = statSync(svgPath).size;

  // Optional calibration sheet: the SAME single isoline element, drawn at all 9 levels.
  // Contour geometry only -- no fills, no lighting, no water. Debug aid, not a deliverable.
  let sheet = null;
  if (SHEET) {
    const all = generateIsolineSvg({
      width: w, height: h, seed, levels: levelsFor(LEVEL_COUNT),
    });
    const sheetPath = join(dir, `sheet9-${w}x${h}.svg`);
    writeFileSync(sheetPath, all.svg, 'utf8');
    sheet = {
      svg: sheetPath,
      png: PREVIEW ? rasterizeSvg(sheetPath, join(dir, `sheet9-${w}x${h}.png`), w, h) : null,
      perLevel: all.stats.levels.map((l) => ({ level: l.level, index: l.index, paths: l.kept, rings: l.rings, open: l.open })),
      ms: +all.timings.totalMs.toFixed(1),
      kb: +(statSync(sheetPath).size / 1024).toFixed(1),
      dpr2: DPR2 && w === 1440
        ? rasterizeSvg(sheetPath, join(dir, `sheet9-${w}x${h}@2x.png`), w, h, { dpr: 2 })
        : null,
    };
  }
  const dpr2 = DPR2 && w === 1440
    ? rasterizeSvg(svgPath, join(dir, `isoline-${w}x${h}@2x.png`), w, h, { dpr: 2 })
    : null;

  // 1:1 原生像素裁切：预览被缩放过就判断不了“细淡”，这块按像素看。
  let crop = null;
  if (PREVIEW && w === 1440) {
    const CROP = { x: 180, y: 280, w: 720, h: 460 };
    const src = decodePng(readFileSync(join(dir, `sheet9-${w}x${h}.png`)));
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
    const cropPath = join(dir, `crop1to1-${w}x${h}.png`);
    writeFileSync(cropPath, encodePng(CROP.w, CROP.h, buf, 3));
    crop = { path: cropPath, rect: CROP };
  }

  report.sizes.push({
    size: `${w}x${h}`,
    svg: svgPath,
    png: pngPath,
    fieldPng,
    svgKB: +(bytes / 1024).toFixed(1),
    svgBytes: bytes,
    field: {
      cols: f.cols,
      rows: f.rows,
      step: f.step,
      pad: f.pad,
      samples: f.cols * f.rows,
      min: +f.min.toFixed(3),
      max: +f.max.toFixed(3),
    },
    timings: Object.fromEntries(Object.entries(gen.timings).map(([k, v]) => [k, +v.toFixed(1)])),
    isoline: gen.stats,
    spacing: {
      median: spacing.median === null ? null : +spacing.median.toFixed(1),
      p10: spacing.p10 === null ? null : +spacing.p10.toFixed(1),
      p90: spacing.p90 === null ? null : +spacing.p90.toFixed(1),
      samples: spacing.samples,
      levelCount: LEVEL_COUNT,
      band: `[${SPACING_BAND.min}, ${SPACING_BAND.max}]px`,
      inBand: spacing.median === null
        ? null
        : spacing.median >= SPACING_BAND.min && spacing.median <= SPACING_BAND.max,
    },
    sheet,
    dpr2,
    crop,
  });
}

const reportPath = join(OUT, `step1-report-${seed}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`report -> ${reportPath}`);
for (const s of report.sizes) {
  console.log(
    [
      s.size.padEnd(10),
      `field ${s.timings.fieldMs}ms`,
      `iso ${s.timings.isolineMs}ms`,
      `total ${s.timings.totalMs}ms`,
      `svg ${s.svgKB}KB`,
      `kept ${s.isoline.kept} (${s.isoline.rings} ring / ${s.isoline.open} open)`,
      `dropped ${s.isoline.droppedShortOpen}+${s.isoline.droppedSmallRing}`,
      `gap median ${s.spacing.median}px [${s.spacing.p10}-${s.spacing.p90}] inBand=${s.spacing.inBand}`,
      s.sheet ? `sheet ${s.sheet.kb}KB / ${s.sheet.ms}ms` : '',
    ].join(' | '),
  );
}
