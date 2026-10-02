// Probe: 不依赖阈值地量层次——整图亮度分位 + 最亮像素（标注）。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTerrain } from '../../src/generate.mjs';
import { renderAtlas, ATLAS_DEFAULTS } from '../../src/atlas.mjs';
import { levelsFor } from '../../src/measure.mjs';
import { rasterizeSvg } from '../rasterize.mjs';
import { decodePng } from '../png-read.mjs';

const OUT = join(process.cwd(), 'out', 'atlas-probe');
mkdirSync(OUT, { recursive: true });
const W = 1440;
const H = 1000;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function analyze(png) {
  const img = decodePng(readFileSync(png));
  const n = img.width * img.height;
  const l = new Float64Array(n);
  let maxL = -1, maxHex = '';
  for (let i = 0, p = 0; i < img.data.length; i += img.channels, p++) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const L = lum(r, g, b);
    l[p] = L;
    if (L > maxL) { maxL = L; maxHex = hex(r, g, b); }
  }
  l.sort();
  const q = (x) => +l[Math.min(n - 1, Math.floor(x * n))].toFixed(1);
  return { 中位: q(0.5), p90: q(0.9), p99: q(0.99), p99_9: q(0.999), 最亮: +maxL.toFixed(1), 最亮色: maxHex };
}

const levels = levelsFor(ATLAS_DEFAULTS.intervals);
const terrain = buildTerrain({ width: W, height: H, seed: 'isopleth-01', levels, bands: null, lighting: null, water: null });

const base = ATLAS_DEFAULTS;
const cases = [
  { name: 'full', options: {} },
  { name: 'majorOnly', options: { minor: { ...base.minor, opacity: 0 }, attribute: { ...base.attribute, every: 0 }, overlay: { noise: null, scanlines: null, vignette: null } } },
  { name: 'minorOnly', options: { major: { ...base.major, opacity: 0 }, attribute: { ...base.attribute, every: 0 }, overlay: { noise: null, scanlines: null, vignette: null } } },
];

for (const c of cases) {
  const { svg } = renderAtlas(terrain, c.options);
  const p = join(OUT, `${c.name}.svg`);
  writeFileSync(p, svg, 'utf8');
  const png = rasterizeSvg(p, join(OUT, `${c.name}.png`), W, H);
  console.log(JSON.stringify({ 变体: c.name, ...analyze(png) }));
}
