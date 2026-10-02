// Throwaway: 按**参考图量出来的**设计语言重做一版（地形仍不变），看能否靠近。
// 参考图实测：底色 #343535(L52) 中性 / 线 #696b6b(L106) / 线比底亮 +54 / 无可见色带台阶。
// 做法是对已生成的 SVG 做定点替换，不改生产代码。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateTerrainSvg } from '../src/node.mjs';
import { levelsFor } from '../src/measure.mjs';
import { rasterizeSvg } from './rasterize.mjs';
import { decodePng } from './png-read.mjs';

const OUT = join(process.cwd(), 'out', 'style');
mkdirSync(OUT, { recursive: true });
const levels = levelsFor(9);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const BASE = '#2b2c2e';   // 中性（B-R = 3，接近参考的 #343535）
const LINE = '#6a6c6c';   // 参考图实测线色

function restyle(svg, { lineOpacity, lineWidth, keepBands }) {
  let s = svg;
  s = s.replace(/fill="#14171a"/g, `fill="${BASE}"`);
  s = s.replace(/stroke="#8ea79a"/g, `stroke="${LINE}"`);
  s = s.replace(/stroke-opacity="0\.14"/g, `stroke-opacity="${lineOpacity}"`);
  s = s.replace(/stroke-width="1"/g, `stroke-width="${lineWidth}"`);
  s = s.replace(/stroke-width="1\.4"/g, `stroke-width="${lineWidth * 1.4}"`);
  if (!keepBands) s = s.replace(/\s*<path d="[^"]*" fill="#ffffff"[^>]*\/>/g, '');
  return s;
}

function lineStats(png) {
  const img = decodePng(readFileSync(png));
  const R = 8, W = img.width, H = img.height;
  const at = (x, y) => {
    const s = (y * W + x) * img.channels;
    return [img.data[s], img.data[s + 1], img.data[s + 2]];
  };
  const lines = [], base = [];
  for (let y = R; y < H - R; y += 1) {
    for (let x = R; x < W - R; x += 1) {
      const [r, g, b] = at(x, y);
      const L = lum(r, g, b);
      const s = [];
      for (const [dx, dy] of [[-R, 0], [R, 0], [0, -R], [0, R]]) { const [r2, g2, b2] = at(x + dx, y + dy); s.push(lum(r2, g2, b2)); }
      s.sort((a, b2) => a - b2);
      const local = (s[1] + s[2]) / 2;
      if (L - local > 18) lines.push([r, g, b, L, local]);
      else if (L - local < 2) base.push(L);
    }
  }
  const med = (arr, i) => { const t = arr.map((v) => (typeof v === 'number' ? v : v[i])).sort((a, b) => a - b); return t[Math.floor(t.length / 2)]; };
  const n = (W - 2 * R) * (H - 2 * R);
  return {
    底色亮度: +med(base, 0).toFixed(0),
    线亮度: +med(lines, 3).toFixed(0),
    '线比底亮': +(med(lines, 3) - med(base, 0)).toFixed(0),
    线覆盖率: +((lines.length / n) * 100).toFixed(2) + '%',
    线色: '#' + [med(lines, 0), med(lines, 1), med(lines, 2)].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''),
  };
}

const cases = [
  { name: 'R1-refstyle-no-bands', bands: null, lineOpacity: 0.85, lineWidth: 1.2, keepBands: false, lighting: { shadowAlpha: 0.5, lightAlpha: 0.16, relief: 300, gradientRadiusPx: 60 } },
  { name: 'R2-refstyle-with-bands', bands: { bandCount: 5, lightenStep: 0.03, contourLevels: levels }, lineOpacity: 0.85, lineWidth: 1.2, keepBands: true, lighting: { shadowAlpha: 0.5, lightAlpha: 0.16, relief: 300, gradientRadiusPx: 60 } },
];

for (const c of cases) {
  const gen = generateTerrainSvg({
    width: 1440, height: 1000, seed: 'isopleth-01', levels,
    bands: c.bands, lighting: true, water: { level: 0.3 },
    background: BASE,
  });
  const svg = restyle(gen.svg, c);
  const p = join(OUT, `${c.name}.svg`);
  writeFileSync(p, svg, 'utf8');
  const png = rasterizeSvg(p, join(OUT, `${c.name}.png`), 1440, 1000);
  console.log(JSON.stringify({ 方案: c.name, svgKB: +(Buffer.byteLength(svg, 'utf8') / 1024).toFixed(0), ...lineStats(png) }));
}
