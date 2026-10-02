// Throwaway probe: line weight / opacity comparison, cropped 1:1 so the difference is
// judged at native pixel scale rather than in a downscaled preview.
//
// Composes the SVG from the low-level pieces on purpose: production code has no
// test-only hooks.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildField } from '../../src/field.mjs';
import { extractIsolines } from '../../src/marching.mjs';
import { simplify } from '../../src/simplify.mjs';
import { catmullRomPath } from '../../src/smooth.mjs';
import { buildSvg } from '../../src/svg.mjs';
import { TOKENS } from '../../src/tokens.mjs';
import { levelsFor } from '../../src/measure.mjs';
import { rasterizeSvg } from '../rasterize.mjs';
import { decodePng, measureLineAlpha } from '../png-read.mjs';
import { encodePng } from '../png.mjs';

const OUT = join(process.cwd(), 'out', 'weight');
mkdirSync(OUT, { recursive: true });

const W = 1440;
const H = 1000;
const SEED = 'isopleth-01';
const CROP = { x: 180, y: 280, w: 720, h: 460 };

const variants = [
  { name: 'Z-baseline-0.7px-12pct', w: 0.7, iw: 1.4, o: 0.12, io: 0.14 },
  { name: 'A-0.7px-14pct', w: 0.7, iw: 1.4, o: 0.14, io: 0.14 },
  { name: 'B-1.0px-12pct', w: 1.0, iw: 1.4, o: 0.12, io: 0.14 },
  { name: 'C-1.0px-14pct', w: 1.0, iw: 1.4, o: 0.14, io: 0.14 },
  { name: 'D-1.2px-14pct', w: 1.2, iw: 1.6, o: 0.14, io: 0.16 },
];

const field = buildField({ width: W, height: H, seed: SEED });
const levels = levelsFor(9);

for (const v of variants) {
  const layers = [];
  levels.forEach((level, k) => {
    const isIndex = (k + 1) % 5 === 0;
    const { paths } = extractIsolines(field, level);
    let d = '';
    for (const p of paths) d += catmullRomPath(simplify(p.points, 1.5), p.closed);
    layers.push({
      d,
      stroke: TOKENS.contour,
      strokeWidth: isIndex ? v.iw : v.w,
      opacity: isIndex ? v.io : v.o,
    });
  });

  const svg = buildSvg({ width: W, height: H, layers, background: TOKENS.ground });
  const svgPath = join(OUT, `${v.name}.svg`);
  writeFileSync(svgPath, svg, 'utf8');
  const pngPath = join(OUT, `${v.name}.png`);
  rasterizeSvg(svgPath, pngPath, W, H);

  const img = decodePng(readFileSync(pngPath));
  const crop = Buffer.alloc(CROP.w * CROP.h * 3);
  for (let y = 0; y < CROP.h; y++) {
    for (let x = 0; x < CROP.w; x++) {
      const s = ((y + CROP.y) * img.width + (x + CROP.x)) * img.channels;
      const d = (y * CROP.w + x) * 3;
      crop[d] = img.data[s];
      crop[d + 1] = img.data[s + 1];
      crop[d + 2] = img.data[s + 2];
    }
  }
  writeFileSync(join(OUT, `crop-${v.name}.png`), encodePng(CROP.w, CROP.h, crop, 3));

  const m = measureLineAlpha(pngPath, TOKENS.ground, TOKENS.contour);
  console.log(JSON.stringify({
    variant: v.name,
    strokePx: v.w,
    opacity: v.o,
    measuredPeak1x: m.peakAlpha,
    meanOverLitPixels: m.meanAlphaOverLitPixels,
    litPixelsPercent: m.litPercent,
  }));
}
