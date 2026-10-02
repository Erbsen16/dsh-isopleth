// Throwaway: 同一份水岸路径，用 evenodd 与 nonzero 各填一次，看哪个和高度场掩膜一致。
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng } from './png-read.mjs';
import { generateTerrainSvg } from '../src/node.mjs';
import { levelsFor } from '../src/measure.mjs';
import { sampleField } from '../src/field.mjs';
import { TOKENS } from '../src/tokens.mjs';
import { rasterizeSvg } from './rasterize.mjs';

const W = Number(process.argv[2] ?? 390);
const H = Number(process.argv[3] ?? 844);
const LEVEL = 0.3;

const gen = generateTerrainSvg({ width: W, height: H, seed: 'isopleth-01', levels: levelsFor(9), water: { level: LEVEL } });
const water = gen.layers.find((l) => l.fill === TOKENS.water);
const f = gen.field;

for (const rule of ['evenodd', 'nonzero']) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#000000"/>
  <path d="${water.d}" fill="${TOKENS.water}" fill-rule="${rule}"/>
</svg>
`;
  const svgPath = `${process.cwd()}/out/_probe-rule-${rule}.svg`;
  const pngPath = `${process.cwd()}/out/_probe-rule-${rule}.png`;
  writeFileSync(svgPath, svg, 'utf8');
  rasterizeSvg(svgPath, pngPath, W, H);

  const img = decodePng(readFileSync(pngPath));
  let both = 0, onlyField = 0, onlyPixel = 0, neither = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = (y * img.width + x) * img.channels;
      const isWaterPixel = img.data[s + 1] - img.data[s] >= 8;
      const h = sampleField(f, f.x0 + f.pad + x, f.y0 + f.pad + y);
      const isWaterField = h < LEVEL;
      if (isWaterField && isWaterPixel) both++;
      else if (isWaterField) onlyField++;
      else if (isWaterPixel) onlyPixel++;
      else neither++;
    }
  }
  const n = both + onlyField + onlyPixel + neither;
  console.log(JSON.stringify({
    rule, size: `${W}x${H}`,
    fieldWaterPercent: +(((both + onlyField) / n) * 100).toFixed(2),
    pixelWaterPercent: +(((both + onlyPixel) / n) * 100).toFixed(2),
    missingPercent: +((onlyField / n) * 100).toFixed(2),
    extraPercent: +((onlyPixel / n) * 100).toFixed(2),
    agreePercent: +(((both + neither) / n) * 100).toFixed(2),
  }));
}
