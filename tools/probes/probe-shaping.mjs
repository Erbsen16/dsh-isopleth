// Throwaway probe: 台地化到底能把「终末地味」拉近多少？（对照参考图的平顶 + 陡崖结构）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateTerrainSvg } from '../../src/node.mjs';
import { levelsFor } from '../../src/measure.mjs';
import { rasterizeSvg } from '../rasterize.mjs';
import { decodePng } from '../png-read.mjs';
import { encodePng } from '../png.mjs';

const W = 1440;
const H = 1000;
const OUT = join(process.cwd(), 'out', 'shaping');
mkdirSync(OUT, { recursive: true });
const levels = levelsFor(9);
const CROP = { x: 200, y: 300, w: 720, h: 460 };

const variants = [
  { name: 'A-baseline-fbm', field: {} },
  { name: 'B-terrace9', field: { shaping: { terrace: { steps: 9, softness: 0.22 } } } },
  { name: 'C-terrace5-bandAligned', field: { shaping: { terrace: { steps: 5, softness: 0.2 } } } },
  { name: 'D-warp-terrace5', field: { shaping: { warp: { amp: 160, wavelength: 1400 }, terrace: { steps: 5, softness: 0.2 } } } },
  { name: 'E-warp-terrace9', field: { shaping: { warp: { amp: 180, wavelength: 1200 }, terrace: { steps: 9, softness: 0.24 } } } },
];

for (const v of variants) {
  const gen = generateTerrainSvg({
    width: W, height: H, seed: 'isopleth-01', levels,
    bands: { bandCount: 5, lightenStep: 0.05, contourLevels: levels },
    lighting: true,
    water: { level: 0.3 },
    field: v.field,
  });
  const svgPath = join(OUT, `${v.name}.svg`);
  writeFileSync(svgPath, gen.svg, 'utf8');
  const png = rasterizeSvg(svgPath, join(OUT, `${v.name}.png`), W, H);

  const img = decodePng(readFileSync(join(OUT, `${v.name}.png`)));
  const buf = Buffer.alloc(CROP.w * CROP.h * 3);
  for (let y = 0; y < CROP.h; y++) {
    for (let x = 0; x < CROP.w; x++) {
      const s = ((y + CROP.y) * img.width + (x + CROP.x)) * img.channels;
      const d = (y * CROP.w + x) * 3;
      buf[d] = img.data[s]; buf[d + 1] = img.data[s + 1]; buf[d + 2] = img.data[s + 2];
    }
  }
  writeFileSync(join(OUT, `crop-${v.name}.png`), encodePng(CROP.w, CROP.h, buf, 3));

  console.log(JSON.stringify({
    variant: v.name,
    svgKB: +(Buffer.byteLength(gen.svg, 'utf8') / 1024).toFixed(1),
    totalMs: +gen.timings.totalMs.toFixed(0),
    fieldMs: +gen.timings.fieldMs.toFixed(0),
    min: +gen.field.min.toFixed(3),
    max: +gen.field.max.toFixed(3),
  }));
}
