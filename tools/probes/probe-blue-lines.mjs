// Throwaway: 蓝线到底是不是「水系」？看蓝线像素的邻域背景是不是水域填色。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../png-read.mjs';

const img = decodePng(readFileSync(join(process.cwd(), 'out', 'tone', 'reference.png')));
const W = img.width, H = img.height;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const at = (x, y) => { const s = (y * W + x) * img.channels; return [img.data[s], img.data[s + 1], img.data[s + 2]]; };

const R = 8, THRESH = 22;
let blue = 0, blueOnWater = 0, neutral = 0, neutralOnWater = 0;
const bluePts = [];

for (let y = R; y < H - R; y++) {
  for (let x = R; x < W - R; x++) {
    const [r, g, b] = at(x, y);
    const L = lum(r, g, b);
    const s = [];
    for (const [dx, dy] of [[-R, 0], [R, 0], [0, -R], [0, R]]) { const [r2, g2, b2] = at(x + dx, y + dy); s.push(lum(r2, g2, b2)); }
    s.sort((p, q) => p - q);
    const local = (s[1] + s[2]) / 2;
    if (L - local <= THRESH) continue;

    // 邻域背景色（8 个方向的中位）
    const neigh = [];
    for (const [dx, dy] of [[-R, 0], [R, 0], [0, -R], [0, R], [-R, -R], [R, R], [-R, R], [R, -R]]) {
      const [r2, g2, b2] = at(x + dx, y + dy);
      neigh.push([r2 - b2, b2 - r2]);
    }
    const br = neigh.map((v) => v[1]).sort((a, b2) => a - b2)[4]; // B-R 中位
    const onWater = br > 8;

    if (b - r > 12) { blue++; if (onWater) blueOnWater++; if (bluePts.length < 6) bluePts.push({ x, y, color: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`, 邻域B_R: br }); }
    else if (Math.abs(b - r) <= 8) { neutral++; if (onWater) neutralOnWater++; }
  }
}

console.log(JSON.stringify({
  蓝线像素: blue,
  '蓝线处于水域填色内': +(blueOnWater / blue * 100).toFixed(1) + '%',
  中性线像素: neutral,
  '中性线处于水域填色内': +(neutralOnWater / neutral * 100).toFixed(1) + '%',
  蓝线样本: bluePts,
}, null, 2));
