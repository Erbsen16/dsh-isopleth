// Throwaway: 台地化之后，迎光提亮是否重新变得合理？（崖壁上的亮面会读成结构，而不是光斑）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateTerrainSvg } from '../src/node.mjs';
import { levelsFor } from '../src/measure.mjs';
import { rasterizeSvg } from './rasterize.mjs';

const OUT = join(process.cwd(), 'out', 'shaping');
mkdirSync(OUT, { recursive: true });
const levels = levelsFor(9);
const terrace = { terrace: { steps: 9, softness: 0.22 } };

const cases = [
  { name: 'B-terrace9-shade-only', field: { shaping: terrace }, lighting: true, water: { level: 0.222 } },
  { name: 'B3-terrace9-with-highlight', field: { shaping: terrace }, lighting: { lightAlpha: 0.14 }, water: { level: 0.222 } },
  { name: 'B4-terrace9-soft30', field: { shaping: { terrace: { steps: 9, softness: 0.34 } } }, lighting: { lightAlpha: 0.14 }, water: { level: 0.222 } },
];

for (const c of cases) {
  const gen = generateTerrainSvg({
    width: 1440, height: 1000, seed: 'isopleth-01', levels,
    bands: { bandCount: 5, lightenStep: 0.05, contourLevels: levels },
    lighting: c.lighting,
    water: c.water,
    field: c.field,
  });
  const p = join(OUT, `${c.name}.svg`);
  writeFileSync(p, gen.svg, 'utf8');
  rasterizeSvg(p, join(OUT, `${c.name}.png`), 1440, 1000);
  console.log(JSON.stringify({ name: c.name, svgKB: +(Buffer.byteLength(gen.svg, 'utf8') / 1024).toFixed(1), totalMs: +gen.timings.totalMs.toFixed(0) }));
}
