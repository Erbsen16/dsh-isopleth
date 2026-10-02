// Throwaway: 参考图的等高线到底有几种颜色？
// 先把「比邻域明显亮」的像素提出来（就是线条像素），再按色相分类统计。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../png-read.mjs';
import { encodePng } from '../png.mjs';

const REF = join(process.cwd(), 'out', 'tone', 'reference.png');
const OUT = join(process.cwd(), 'out', 'tone');
mkdirSync(OUT, { recursive: true });

const img = decodePng(readFileSync(REF));
const W = img.width, H = img.height;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const at = (x, y) => {
  const s = (y * W + x) * img.channels;
  return [img.data[s], img.data[s + 1], img.data[s + 2]];
};

const R = 8;
const THRESH = 22;

const classes = {
  中性: { test: (r, g, b) => Math.abs(b - r) <= 8 && Math.abs(g - r) <= 8, px: [] },
  偏蓝: { test: (r, g, b) => b - r > 12, px: [] },
  偏黄: { test: (r, g, b) => r - b > 12 && g - b > 8, px: [] },
  其他: { test: () => true, px: [] },
};

// 可视化：每类用自己的中位色画出来
const vis = Buffer.alloc(W * H * 3, 0);

const linePx = [];
for (let y = R; y < H - R; y++) {
  for (let x = R; x < W - R; x++) {
    const [r, g, b] = at(x, y);
    const L = lum(r, g, b);
    const s = [];
    for (const [dx, dy] of [[-R, 0], [R, 0], [0, -R], [0, R]]) {
      const [r2, g2, b2] = at(x + dx, y + dy);
      s.push(lum(r2, g2, b2));
    }
    s.sort((p, q) => p - q);
    const local = (s[1] + s[2]) / 2;
    if (L - local > THRESH) linePx.push([x, y, r, g, b, L - local]);
  }
}

for (const [x, y, r, g, b, d] of linePx) {
  for (const [name, c] of Object.entries(classes)) {
    if (c.test(r, g, b)) { c.px.push([r, g, b, d]); break; }
  }
}

const med = (arr, i) => { const t = arr.map((v) => v[i]).sort((a, b) => a - b); return t[Math.floor(t.length / 2)]; };
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

const total = linePx.length;
const report = { 线条像素: total, 阈值: `比邻域亮 >${THRESH}`, 分类: {} };
for (const [name, c] of Object.entries(classes)) {
  if (!c.px.length) { report.分类[name] = { 占比: '0%' }; continue; }
  const r = med(c.px, 0), g = med(c.px, 1), b = med(c.px, 2);
  report.分类[name] = {
    占比: +((c.px.length / total) * 100).toFixed(1) + '%',
    中位色: hex(r, g, b),
    中位亮度: Math.round(lum(r, g, b)),
    'G-R': Math.round(g - r),
    'B-R': Math.round(b - r),
    亮度增益中位: +med(c.px, 3).toFixed(0),
  };
}
console.log(JSON.stringify(report, null, 2));

// 可视化：中性灰白、偏蓝画青、偏黄画黄
const colors = { 中性: [235, 235, 235], 偏蓝: [60, 200, 255], 偏黄: [255, 220, 60], 其他: [255, 80, 80] };
for (const [x, y, r, g, b] of linePx) {
  let name = '其他';
  for (const [n, c] of Object.entries(classes)) { if (c.test(r, g, b)) { name = n; break; } }
  const c = colors[name];
  const d = (y * W + x) * 3;
  vis[d] = c[0]; vis[d + 1] = c[1]; vis[d + 2] = c[2];
}
writeFileSync(join(OUT, 'reference-line-classes.png'), encodePng(W, H, vis, 3));
console.log(`可视化 -> ${join(OUT, 'reference-line-classes.png')}`);
