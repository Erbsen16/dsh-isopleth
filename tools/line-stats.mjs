// 从渲染结果里反解「线的设计语言」：底色亮度/色、线亮度/色、线比底亮、线覆盖率。
// 参考图与我的产物用同一把尺子，数字才可比。
// 判据：像素亮度比邻域（上下左右各 8px 的中间值）高出 18 以上 = 等高线像素。
import { readFileSync } from 'node:fs';
import { decodePng } from './png-read.mjs';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function lineStats(pngPath, crop) {
  const img = decodePng(readFileSync(pngPath));
  const x0 = crop ? crop.x : 0;
  const y0 = crop ? crop.y : 0;
  const W = crop ? crop.w : img.width;
  const H = crop ? crop.h : img.height;
  const R = 8;
  const at = (x, y) => {
    const s = ((y + y0) * img.width + (x + x0)) * img.channels;
    return [img.data[s], img.data[s + 1], img.data[s + 2]];
  };

  const lines = [];
  const base = [];
  let sampled = 0;
  for (let y = R; y < H - R; y += 2) {
    for (let x = R; x < W - R; x += 2) {
      const [r, g, b] = at(x, y);
      const L = lum(r, g, b);
      const s = [];
      for (const [dx, dy] of [[-R, 0], [R, 0], [0, -R], [0, R]]) {
        const [r2, g2, b2] = at(x + dx, y + dy);
        s.push(lum(r2, g2, b2));
      }
      s.sort((p, q) => p - q);
      const local = (s[1] + s[2]) / 2;
      sampled++;
      if (L - local > 18) lines.push([r, g, b, L]);
      else if (L - local < 2) base.push([r, g, b, L]);
    }
  }

  const med = (arr, i) => {
    const t = arr.map((v) => (typeof v === 'number' ? v : v[i])).sort((a, b) => a - b);
    return t[Math.floor(t.length / 2)];
  };

  const baseL = base.length ? med(base, 3) : null;
  const lineL = lines.length ? med(lines, 3) : null;
  return {
    区域: `${W}x${H}`,
    采样点: sampled,
    底色: base.length ? hex(med(base, 0), med(base, 1), med(base, 2)) : null,
    底色亮度: baseL === null ? null : +baseL.toFixed(0),
    线色: lines.length ? hex(med(lines, 0), med(lines, 1), med(lines, 2)) : null,
    线亮度: lineL === null ? null : +lineL.toFixed(0),
    线比底亮: baseL === null || lineL === null ? null : +(lineL - baseL).toFixed(0),
    线覆盖率: +((lines.length / sampled) * 100).toFixed(2) + '%',
  };
}
