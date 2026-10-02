// Throwaway: 把「风格」量化——参考图 vs 我的产物，同样的色调/饱和度统计。
// 参考图是 JPEG，先用 Edge 光栅化成 PNG 再解码（自写解码器只认 PNG）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { decodePng } from './png-read.mjs';

const REF = process.argv[2];
if (!REF) { console.error('usage: node tools/probe-reference-tone.mjs <ref.jpg>'); process.exit(1); }

const scratch = join(tmpdir(), 'dsh-tone');
mkdirSync(scratch, { recursive: true });
const OUT = join(process.cwd(), 'out', 'tone');
mkdirSync(OUT, { recursive: true });

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function jpegToPng(src, w, h) {
  const html = join(scratch, 'ref.html');
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000}` +
      `img{display:block;width:${w}px;height:${h}px}</style><img src="${pathToFileURL(src).href}">`,
    'utf8',
  );
  const png = join(OUT, 'reference.png');
  spawnSync(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${join(scratch, 'p')}`,
    `--window-size=${w},${h}`, `--screenshot=${png}`, pathToFileURL(html).href,
  ], { stdio: 'ignore', timeout: 120000 });
  return existsSync(png) ? png : null;
}

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

function analyze(file, label) {
  const img = decodePng(readFileSync(file));
  const n = img.width * img.height;
  const lums = new Float64Array(n);
  const buckets = new Array(16).fill(0);
  const tones = new Map();
  let dark = 0, mid = 0, lit = 0, saturated = 0, colorful = 0;
  let sumL = 0;

  for (let i = 0, p = 0; i < img.data.length; i += img.channels, p++) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const L = lum(r, g, b);
    lums[p] = L;
    sumL += L;
    buckets[Math.min(15, Math.floor(L * 16))]++;
    if (L < 0.06) dark++; else if (L < 0.22) mid++; else lit++;
    const s = sat(r, g, b);
    if (s > 0.18) saturated++;
    if (s > 0.10 && L > 0.12) colorful++;
    // 量化到 8 级做众数统计
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    tones.set(key, (tones.get(key) ?? 0) + 1);
  }

  lums.sort();
  const q = (x) => +(lums[Math.min(n - 1, Math.floor(x * n))] * 255).toFixed(1);
  const top = [...tones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, c]) => {
    const r = ((k >> 10) & 31) << 3, g = ((k >> 5) & 31) << 3, b = (k & 31) << 3;
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    return `${hex} ${((c / n) * 100).toFixed(1)}%`;
  });

  return {
    label,
    size: `${img.width}x${img.height}`,
    平均亮度: +(sumL / n).toFixed(3),
    亮度分位: { p1: q(0.01), p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99) },
    近黑占比: +((dark / n) * 100).toFixed(1) + '% (<6%)',
    暗部占比: +((mid / n) * 100).toFixed(1) + '% (6~22%)',
    中亮占比: +((lit / n) * 100).toFixed(1) + '% (>22%)',
    高饱和像素: +((saturated / n) * 100).toFixed(2) + '%',
    彩色像素: +((colorful / n) * 100).toFixed(2) + '%',
    主导色: top,
    亮度直方图: buckets.map((c) => +((c / n) * 100).toFixed(1)),
  };
}

const refPng = jpegToPng(REF, 2190, 1327);
const rows = [];
if (refPng) rows.push(analyze(refPng, '参考图'));
for (const f of process.argv.slice(3)) rows.push(analyze(f, basename(f)));
console.log(JSON.stringify(rows, null, 2));
