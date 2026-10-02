// Throwaway: 把「高度场判为水」与「渲染是水色」的差异画成一张图，直接看缺在哪。
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng } from './png-read.mjs';
import { encodePng } from './png.mjs';
import { generateTerrainSvg } from '../src/node.mjs';
import { levelsFor } from '../src/measure.mjs';
import { sampleField } from '../src/field.mjs';
import { rasterizeSvg } from './rasterize.mjs';

const W = Number(process.argv[2] ?? 1440);
const H = Number(process.argv[3] ?? 1000);
const LEVEL = 0.3;
const gen = generateTerrainSvg({ width: W, height: H, seed: 'isopleth-01', levels: levelsFor(9), water: { level: LEVEL } });
writeFileSync(`${process.cwd()}/out/_probe-c.svg`, gen.svg, 'utf8');
rasterizeSvg(`${process.cwd()}/out/_probe-c.svg`, `${process.cwd()}/out/_probe-c.png`, W, H);

const img = decodePng(readFileSync(`${process.cwd()}/out/_probe-c.png`));
const f = gen.field;
const raw = Buffer.alloc(W * H * 3);

let onlyField = 0, onlyPixel = 0, both = 0, neither = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const s = (y * img.width + x) * img.channels;
    const g = img.data[s + 1];
    const r = img.data[s];
    const isWaterPixel = g - r >= 8;
    // 视口左/上边缘在世界坐标里是 x0 + pad
    const h = sampleField(f, f.x0 + f.pad + x, f.y0 + f.pad + y);
    const isWaterField = h < LEVEL;
    let c;
    if (isWaterField && isWaterPixel) { c = [30, 90, 60]; both++; }
    else if (isWaterField && !isWaterPixel) { c = [255, 60, 60]; onlyField++; }
    else if (!isWaterField && isWaterPixel) { c = [60, 120, 255]; onlyPixel++; }
    else { c = [20, 20, 24]; neither++; }
    const d = (y * W + x) * 3;
    raw[d] = c[0]; raw[d + 1] = c[1]; raw[d + 2] = c[2];
  }
}
writeFileSync(`${process.cwd()}/out/_probe-diff.png`, encodePng(W, H, raw, 3));

const parts = both + onlyField + onlyPixel + neither;
console.log(JSON.stringify({
  fieldWaterPercent: +(((both + onlyField) / parts) * 100).toFixed(2),
  pixelWaterPercent: +(((both + onlyPixel) / parts) * 100).toFixed(2),
  missingWaterPixels: onlyField,
  extraWaterPixels: onlyPixel,
  agreePercent: +(((both + neither) / parts) * 100).toFixed(2),
}, null, 2));
