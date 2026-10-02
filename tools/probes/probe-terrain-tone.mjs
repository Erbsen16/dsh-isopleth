// Throwaway: 从参考图里裁一块「纯地形」区域（避开建筑与黄色高亮），
// 单独统计它的设计语言，和我的产物对比。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../png-read.mjs';
import { encodePng } from '../png.mjs';

const REF = join(process.cwd(), 'out', 'tone', 'reference.png');
// 参考图里这块基本只有地形与极淡的等高线：右侧中下、避开建筑群、避开黄色区域与右下 UI
const CROP = { x: 1200, y: 600, w: 650, h: 550 };

const img = decodePng(readFileSync(REF));
const buf = Buffer.alloc(CROP.w * CROP.h * 3);
for (let y = 0; y < CROP.h; y++) {
  for (let x = 0; x < CROP.w; x++) {
    const s = ((y + CROP.y) * img.width + (x + CROP.x)) * img.channels;
    const d = (y * CROP.w + x) * 3;
    buf[d] = img.data[s]; buf[d + 1] = img.data[s + 1]; buf[d + 2] = img.data[s + 2];
  }
}
const out = join(process.cwd(), 'out', 'tone', 'reference-terrain-crop.png');
writeFileSync(out, encodePng(CROP.w, CROP.h, buf, 3));

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

function stats(data, channels, n) {
  const buckets = new Array(16).fill(0);
  const lums = new Float64Array(n);
  const tones = new Map();
  let colorful = 0, sumL = 0;
  for (let i = 0, p = 0; i < data.length; i += channels, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const L = lum(r, g, b);
    lums[p] = L; sumL += L;
    buckets[Math.min(15, Math.floor(L * 16))]++;
    if (sat(r, g, b) > 0.10 && L > 0.12) colorful++;
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    tones.set(k, (tones.get(k) ?? 0) + 1);
  }
  lums.sort();
  const q = (x) => +(lums[Math.floor(x * n)] * 255).toFixed(0);
  const top = [...tones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => {
    const r = ((k >> 10) & 31) << 3, g = ((k >> 5) & 31) << 3, b = (k & 31) << 3;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') + ` ${((c / n) * 100).toFixed(1)}%`;
  });
  return {
    平均亮度: +(sumL / n).toFixed(3),
    p1: q(0.01), p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99),
    彩色占比: +((colorful / n) * 100).toFixed(1) + '%',
    主导色: top,
    直方图: buckets.map((c) => +((c / n) * 100).toFixed(1)),
  };
}

console.log('参考图 · 纯地形区');
console.log(JSON.stringify(stats(buf, 3, CROP.w * CROP.h), null, 2));

const mine = decodePng(readFileSync(join(process.cwd(), 'out', 'style', 'S2-neutral-ground.png')));
console.log('\n我的产物 · S2 中性底色');
console.log(JSON.stringify(stats(mine.data, mine.channels, mine.width * mine.height), null, 2));
console.log(`\ncrop -> ${out}`);
