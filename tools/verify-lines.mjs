// Pixel-level acceptance for the contour strokes: render ONE level on its own (fine and
// index separately) at 1x and 2x, then measure the alpha that actually reached the
// screen. Run: node tools/verify-lines.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateIsolineSvg } from '../src/generate.mjs';
import { TOKENS, STROKE, SPACING_BAND } from '../src/tokens.mjs';
import { rasterizeSvg } from '../tools/rasterize.mjs';
import { measureLineAlpha } from '../tools/png-read.mjs';

const OUT = join(process.cwd(), 'out', 'verify');
mkdirSync(OUT, { recursive: true });

const W = 1440;
const H = 1000;
const SEED = 'isopleth-01';

const cases = [
  { name: 'fine-0.7px-12pct', level: 0.5, indexEvery: 5, stroke: 0.7, opacity: 0.12 },
  { name: 'fine-1.0px-14pct', level: 0.5, indexEvery: 5, stroke: 1.0, opacity: 0.14 },
  { name: 'index-1.4px-14pct', level: 0.5, indexEvery: 1, stroke: 1.4, opacity: 0.14 },
];

const rows = [];
for (const c of cases) {
  const gen = generateIsolineSvg({
    width: W, height: H, seed: SEED, levels: [c.level],
    indexEvery: c.indexEvery,
    field: {},
    // stroke/opacity come from tokens; cases that differ are patched via the layer list
  });

  // Patch the emitted stroke attributes for the experiment (production path untouched).
  const svg = gen.svg
    .replaceAll(`stroke-width="${STROKE.contour}"`, `stroke-width="${c.stroke}"`)
    .replaceAll(`stroke-width="${STROKE.indexContour}"`, `stroke-width="${c.stroke}"`)
    .replaceAll(`stroke-opacity="${TOKENS.contourOpacity}"`, `stroke-opacity="${c.opacity}"`)
    .replaceAll(`stroke-opacity="${TOKENS.indexContourOpacity}"`, `stroke-opacity="${c.opacity}"`);

  const svgPath = join(OUT, `${c.name}.svg`);
  writeFileSync(svgPath, svg, 'utf8');
  const row = { case: c.name, stroke: c.stroke, opacity: c.opacity };
  for (const dpr of [1, 2]) {
    const png = join(OUT, `${c.name}@${dpr}x.png`);
    rasterizeSvg(svgPath, png, W, H, { dpr });
    const m = measureLineAlpha(png, TOKENS.ground, TOKENS.contour);
    row[`peak@${dpr}x`] = `${m.peakAlpha}%`;
    row[`p50@${dpr}x`] = `${m.p50}%`;
    row[`p90@${dpr}x`] = `${m.p90}%`;
    row[`blend@${dpr}x`] = m.peakBlendHex;
    if (dpr === 1) row.inBand1x_p90 = m.p90 >= 8 && m.p90 <= 14;
  }
  rows.push(row);
}

console.log(JSON.stringify({ band: `[${SPACING_BAND.min},${SPACING_BAND.max}]px (spacing)`, strokeOpacityBand: '8%~14%', rows }, null, 2));
