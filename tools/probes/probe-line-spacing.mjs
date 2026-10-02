// Throwaway: 直接在渲染图上量等高线间距（相邻两条线的像素距离），参考图 vs 我的产物。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../png-read.mjs';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function spacing(file, label, crop, { rise = 18, radius = 8, rows = 40, dedup = 3 } = {}) {
  const img = decodePng(readFileSync(file));
  const x0 = crop ? crop.x : 0, y0 = crop ? crop.y : 0;
  const w = crop ? crop.w : img.width, h = crop ? crop.h : img.height;
  const at = (x, y) => {
    const s = ((y + y0) * img.width + (x + x0)) * img.channels;
    return lum(img.data[s], img.data[s + 1], img.data[s + 2]);
  };

  const gaps = [];
  for (let r = 0; r < rows; r++) {
    const y = radius + Math.floor(((r + 0.5) * (h - 2 * radius)) / rows);
    const hits = [];
    for (let x = radius + 2; x < w - radius - 2; x++) {
      const L = at(x, y);
      const left = (at(x - radius, y) + at(x - radius + 1, y)) / 2;
      const right = (at(x + radius, y) + at(x + radius - 1, y)) / 2;
      const local = Math.min(left, right);
      if (L - local > rise && L >= at(x - 1, y) && L >= at(x + 1, y)) {
        if (!hits.length || x - hits[hits.length - 1] > dedup) hits.push(x);
      }
    }
    for (let i = 1; i < hits.length; i++) gaps.push(hits[i] - hits[i - 1]);
  }

  gaps.sort((a, b) => a - b);
  const q = (p) => (gaps.length ? gaps[Math.floor(p * gaps.length)] : 0);
  return {
    样本: label,
    检出线数: gaps.length + rows,
    间距中位: q(0.5),
    间距p25: q(0.25),
    间距p75: q(0.75),
    间距p90: q(0.9),
    所用阈值: `比邻域亮 >${rise}`,
  };
}

const REF = join(process.cwd(), 'out', 'tone', 'reference.png');
// 避开右上角的 115° 细排线，只量纯地形区
console.log(JSON.stringify(spacing(REF, '参考图 · 无排线的地形区 (1230,820,520x330)', { x: 1230, y: 820, w: 520, h: 330 }, { dedup: 6 }), null, 2));
console.log(JSON.stringify(spacing(REF, '参考图 · 含排线区（会被高频排线污染，作对照）', { x: 1200, y: 600, w: 650, h: 550 }), null, 2));
console.log(JSON.stringify(spacing(join(process.cwd(), 'out', 'style', 'S2-neutral-ground.png'), '我的产物 S2', null, { rise: 4, dedup: 6 }), null, 2));
