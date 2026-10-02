// Throwaway: 地形**完全不变**（同一个 seed、同一套 fBm 参数），只改设计语言，
// 看色调统计能不能靠近参考图那种「连续中性灰 + 极少量色彩」。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateTerrainSvg } from '../../src/node.mjs';
import { levelsFor } from '../../src/measure.mjs';
import { rasterizeSvg } from '../rasterize.mjs';
import { decodePng } from '../png-read.mjs';

const OUT = join(process.cwd(), 'out', 'style');
mkdirSync(OUT, { recursive: true });
const W = 1440, H = 1000;
const levels = levelsFor(9);

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

function stats(png) {
  const img = decodePng(readFileSync(png));
  const n = img.width * img.height;
  const buckets = new Array(16).fill(0);
  const lums = new Float64Array(n);
  let colorful = 0, sumL = 0;
  for (let i = 0, p = 0; i < img.data.length; i += img.channels, p++) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const L = lum(r, g, b);
    lums[p] = L; sumL += L;
    buckets[Math.min(15, Math.floor(L * 16))]++;
    if (sat(r, g, b) > 0.10 && L > 0.12) colorful++;
  }
  lums.sort();
  const q = (x) => +(lums[Math.floor(x * n)] * 255).toFixed(0);
  // 直方图有几个「峰」被填满 = 台阶感
  const filled = buckets.filter((c) => c / n > 0.02).length;
  return {
    平均亮度: +(sumL / n).toFixed(3),
    p5: q(0.05), p50: q(0.5), p95: q(0.95),
    彩色占比: +((colorful / n) * 100).toFixed(1),
    直方图: buckets.map((c) => +((c / n) * 100).toFixed(1)),
    有效档位数: filled,
  };
}

const cases = [
  { name: 'S0-current-5bands-5pct', config: {} },
  { name: 'S1-ninebands-2.5pct', config: { bands: { bandCount: 9, lightenStep: 0.025, contourLevels: levels } } },
  { name: 'S2-neutral-ground', config: { background: '#17181a' } },
  { name: 'S3-ninebands-neutral-wideShade', config: {
      bands: { bandCount: 9, lightenStep: 0.025, contourLevels: levels },
      background: '#17181a',
      lighting: { shadowAlpha: 0.45, gradientRadiusPx: 60, relief: 240 },
    } },
];

const rows = [];
for (const c of cases) {
  const gen = generateTerrainSvg({
    width: W, height: H, seed: 'isopleth-01', levels,
    bands: { bandCount: 5, lightenStep: 0.05, contourLevels: levels },
    lighting: true,
    water: { level: 0.3 },
    ...c.config,
  });
  const svgPath = join(OUT, `${c.name}.svg`);
  writeFileSync(svgPath, gen.svg, 'utf8');
  const png = rasterizeSvg(svgPath, join(OUT, `${c.name}.png`), W, H);
  rows.push({ 方案: c.name, svgKB: +(Buffer.byteLength(gen.svg, 'utf8') / 1024).toFixed(0), ...stats(png) });
}
console.log(JSON.stringify(rows, null, 2));
