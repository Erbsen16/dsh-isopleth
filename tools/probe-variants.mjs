// Throwaway probe: visual comparison of fBm gain / DP tolerance variants.
// Renders a 9-level debug sheet (contour geometry only, no fills) plus the single
// level-0.5 view, at 1440x1000.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateIsolineSvg } from '../src/node.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';
import { rasterizeSvg } from '../tools/rasterize.mjs';

const OUT = join(process.cwd(), 'out', 'calib');
mkdirSync(OUT, { recursive: true });

const variants = [
  { name: 'g50-dp115', gain: 0.5, contrast: 1.6, baseWavelength: 560, dpTolerance: 1.15 },
  { name: 'g42-dp150', gain: 0.42, contrast: 1.5, baseWavelength: 560, dpTolerance: 1.5 },
  { name: 'g36-dp180', gain: 0.36, contrast: 1.45, baseWavelength: 560, dpTolerance: 1.8 },
  { name: 'g42w700-dp150', gain: 0.42, contrast: 1.5, baseWavelength: 700, dpTolerance: 1.5 },
];

const W = 1440;
const H = 1000;

for (const v of variants) {
  const field = { gain: v.gain, contrast: v.contrast, baseWavelength: v.baseWavelength, octaves: 6 };

  const nine = generateIsolineSvg({
    width: W, height: H, seed: 'isopleth-01', levels: levelsFor(9),
    dpTolerance: v.dpTolerance, field,
  });
  const p9 = join(OUT, `nine-${v.name}.svg`);
  writeFileSync(p9, nine.svg, 'utf8');
  rasterizeSvg(p9, join(OUT, `nine-${v.name}.png`), W, H);

  const one = generateIsolineSvg({
    width: W, height: H, seed: 'isopleth-01', levels: [0.5],
    dpTolerance: v.dpTolerance, field,
  });
  const p1 = join(OUT, `one-${v.name}.svg`);
  writeFileSync(p1, one.svg, 'utf8');
  rasterizeSvg(p1, join(OUT, `one-${v.name}.png`), W, H);

  const sp = medianContourSpacing(one.field, 9, { scanlines: 31 });
  console.log(JSON.stringify({
    variant: v.name,
    min: +one.field.min.toFixed(3),
    max: +one.field.max.toFixed(3),
    medianGap: +sp.median.toFixed(1),
    p90: +sp.p90.toFixed(1),
    nineLevelBytes: nine.svg.length,
    vertices: nine.stats.verticesAfterSimplify,
    fieldMs: +nine.timings.fieldMs.toFixed(1),
    nineLevelMs: +nine.timings.totalMs.toFixed(1),
  }));
}
