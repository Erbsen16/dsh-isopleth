// Throwaway: 提取「等高线像素」（比邻域明显亮）并统计线色/线亮度/覆盖率。
// 参考图 vs 我的产物，同一把尺子。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from './png-read.mjs';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function analyze(file, label, crop) {
  const img = decodePng(readFileSync(file));
  const x0 = crop ? crop.x : 0, y0 = crop ? crop.y : 0;
  const w = crop ? crop.w : img.width, h = crop ? crop.h : img.height;
  const at = (x, y) => {
    const s = ((y + y0) * img.width + (x + x0)) * img.channels;
    return [img.data[s], img.data[s + 1], img.data[s + 2]];
  };

  const R = 8; // 邻域半径
  const lines = [];
  const base = [];
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      const [r, g, b] = at(x, y);
      const L = lum(r, g, b);
      // 邻域取 8 个方向的中位数，避免被线自己污染
      const samples = [];
      for (const [dx, dy] of [[-R, 0], [R, 0], [0, -R], [0, R], [-R, -R], [R, R], [-R, R], [R, -R]]) {
        const [r2, g2, b2] = at(x + dx, y + dy);
        samples.push(lum(r2, g2, b2));
      }
      samples.sort((p, q) => p - q);
      const local = samples[4];
      if (L - local > 18) lines.push([r, g, b, L, local]);
      else if (L - local < 2) base.push([r, g, b, L]);
    }
  }

  const med = (arr, i) => { const s = arr.map((v) => v[i]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const n = (w - 2 * R) * (h - 2 * R);
  const lineLum = lines.length ? med(lines, 3) : 0;
  const baseLum = base.length ? med(base, 3) : 0;
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  return {
    样本: label,
    区域: `${w}x${h}`,
    底色亮度: +baseLum.toFixed(0),
    底色: toHex(med(base, 0), med(base, 1), med(base, 2)),
    线亮度: +lineLum.toFixed(0),
    线色: toHex(med(lines, 0), med(lines, 1), med(lines, 2)),
    '线比底亮': +(lineLum - baseLum).toFixed(0),
    线覆盖率: +((lines.length / n) * 100).toFixed(2) + '%',
    线色偏移: (() => {
      const r = med(lines, 0), g = med(lines, 1), b = med(lines, 2);
      return `R${Math.round(r)}, G${Math.round(g)}, B${Math.round(b)}  → G-R=${Math.round(g - r)}, B-R=${Math.round(b - r)}`;
    })(),
  };
}

const REF = join(process.cwd(), 'out', 'tone', 'reference.png');
console.log(JSON.stringify(analyze(REF, '参考图 · 纯地形区', { x: 1200, y: 600, w: 650, h: 550 }), null, 2));
console.log(JSON.stringify(analyze(join(process.cwd(), 'out', 'style', 'S2-neutral-ground.png'), '我的产物 S2', null), null, 2));
