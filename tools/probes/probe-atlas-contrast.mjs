// Probe: 量「主线 vs 辅线」的层次差 与 「高程标注」的实际像素亮度。
// 做法：分别只出主线 / 只出辅线，各自过一遍 line-stats；再找全图最亮像素（标注/点）。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTerrain } from '../../src/generate.mjs';
import { renderAtlas, ATLAS_DEFAULTS } from '../../src/atlas.mjs';
import { levelsFor } from '../../src/measure.mjs';
import { rasterizeSvg } from '../rasterize.mjs';
import { decodePng } from '../png-read.mjs';
import { lineStats } from '../line-stats.mjs';

const OUT = join(process.cwd(), 'out', 'atlas-probe');
mkdirSync(OUT, { recursive: true });
const W = 1440;
const H = 1000;

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function brightest(png) {
  const img = decodePng(readFileSync(png));
  let best = { L: -1 };
  const top = [];
  for (let i = 0; i < img.data.length; i += img.channels) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const L = lum(r, g, b);
    if (L > best.L) best = { L: +L.toFixed(1), hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') };
    if (L > 60) top.push([r, g, b]);
  }
  const n = img.data.length / img.channels;
  return { 最亮像素: best, '亮度>60的像素占比': +((top.length / n) * 100).toFixed(3) + '%' };
}

const levels = levelsFor(ATLAS_DEFAULTS.intervals);
const terrain = buildTerrain({ width: W, height: H, seed: 'isopleth-01', levels, bands: null, lighting: null, water: null });

const cases = [
  { name: 'full', options: {} },
  { name: 'majorOnly', options: { minor: { ...ATLAS_DEFAULTS.minor, opacity: 0 }, attribute: { ...ATLAS_DEFAULTS.attribute, every: 0 }, overlay: { noise: null, scanlines: null, vignette: null } } },
  { name: 'minorOnly', options: { major: { ...ATLAS_DEFAULTS.major, opacity: 0 }, attribute: { ...ATLAS_DEFAULTS.attribute, every: 0 }, overlay: { noise: null, scanlines: null, vignette: null } } },
];

for (const c of cases) {
  const { svg } = renderAtlas(terrain, c.options);
  const p = join(OUT, `${c.name}.svg`);
  writeFileSync(p, svg, 'utf8');
  const png = rasterizeSvg(p, join(OUT, `${c.name}.png`), W, H);
  const stats = lineStats(png);
  console.log(JSON.stringify({
    变体: c.name,
    线色: stats.线色, 线亮度: stats.线亮度, 线比底亮: stats['线比底亮'], 覆盖率: stats.线覆盖率,
    ...(c.name === 'full' ? brightest(png) : {}),
  }));
}
