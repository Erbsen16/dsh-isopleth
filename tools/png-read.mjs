// Minimal PNG reader for verification (8-bit, colour types 0/2/4/6, no interlace).
// Used to measure what actually reached the pixels, instead of trusting the CSS numbers.

import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let interlace = 0;
  const idat = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  const ch = CHANNELS[colorType];
  if (!ch) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }

  return { width, height, channels: ch, data: out };
}

/** Alpha of a drawn line colour over a known ground colour, from dominant-channel delta. */
export function measureLineAlpha(file, groundHex, lineHex) {
  const img = decodePng(readFileSync(file));
  const g = hexToRgb(groundHex);
  const l = hexToRgb(lineHex);
  const span = Math.max(l[0] - g[0], l[1] - g[1], l[2] - g[2]);

  let peak = 0;
  let sum = 0;
  let lit = 0;
  const alphas = [];

  for (let i = 0; i < img.data.length; i += img.channels) {
    const d = Math.max(
      img.data[i] - g[0],
      img.data[i + 1] - g[1],
      img.data[i + 2] - g[2],
    );
    const alpha = Math.max(0, Math.min(1, d / span));
    if (alpha > peak) peak = alpha;
    if (alpha > 0.01) {
      lit++;
      sum += alpha;
      alphas.push(alpha);
    }
  }
  alphas.sort((a, b) => a - b);
  const q = (p) => (alphas.length ? alphas[Math.min(alphas.length - 1, Math.floor(p * alphas.length))] : 0);

  return {
    file,
    pixels: img.data.length / img.channels,
    size: `${img.width}x${img.height}`,
    peakAlpha: +(peak * 100).toFixed(2),
    p50: +(q(0.5) * 100).toFixed(2),
    p90: +(q(0.9) * 100).toFixed(2),
    p99: +(q(0.99) * 100).toFixed(2),
    meanAlphaOverLitPixels: +((sum / Math.max(1, lit)) * 100).toFixed(2),
    litPixels: lit,
    litPercent: +((lit / (img.data.length / img.channels)) * 100).toFixed(2),
    peakBlendHex: rgbToHex(mix(g, l, peak)),
  };
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgbToHex(rgb) {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
export function mixWhite(hex, alpha) {
  const g = hexToRgb(hex);
  return g.map((v) => v + (255 - v) * alpha);
}
/** 白叠加色阶：alpha 为 0 的档不叠加，返回每一档的预期颜色。 */
export function toneLadder(groundHex, lightenStep, bandCount) {
  return Array.from({ length: bandCount }, (_, k) => ({
    k,
    alpha: +(k * lightenStep).toFixed(4),
    rgb: mixWhite(groundHex, k * lightenStep),
    hex: rgbToHex(mixWhite(groundHex, k * lightenStep)),
  }));
}

/**
 * 统计渲染结果里各色带档位实际占了多少像素，验证“每级亮 step%”真的落到了像素上。
 * `other` 是线条、抗锯齿与边界像素。
 */
export function measureTones(file, groundHex, lightenStep, bandCount, tolerance = 2.0) {
  const img = decodePng(readFileSync(file));
  const ladder = toneLadder(groundHex, lightenStep, bandCount);
  const counts = ladder.map(() => 0);
  let other = 0;
  const total = img.data.length / img.channels;

  for (let i = 0; i < img.data.length; i += img.channels) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    let best = -1, bestD = Infinity;
    for (let k = 0; k < ladder.length; k++) {
      const t = ladder[k].rgb;
      const d = Math.abs(r - t[0]) + Math.abs(g - t[1]) + Math.abs(b - t[2]);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (bestD <= tolerance * 3) counts[best]++;
    else other++;
  }

  // 实测台阶差（相邻档的实际 rgb 距离）
  const steps = [];
  for (let k = 1; k < ladder.length; k++) {
    const a = ladder[k - 1].rgb, b = ladder[k].rgb;
    steps.push(+(Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2])).toFixed(1));
  }

  return {
    file,
    ladder: ladder.map((t) => t.hex),
    bandPixelPercent: counts.map((c) => +((c / total) * 100).toFixed(2)),
    otherPercent: +((other / total) * 100).toFixed(2),
    rgbStepBetweenBands: steps,
  };
}
function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}
