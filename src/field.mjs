// Height field sampled on a fixed world-space lattice.
//
// World space is independent of the viewport: 1 world unit == 1 CSS px, origin at the
// viewport centre. Feature size is therefore constant in px, so a wide viewport shows
// *more* terrain instead of stretched terrain. No tiling, no repetition, no seams.

import { fbm, hashSeed } from './noise.mjs';

export const FIELD_DEFAULTS = {
  pad: 64,             // px sampled beyond the viewport, so culling never reveals a gap
  step: 3,             // px between lattice samples
  octaves: 6,          // fBm octave count (spec: 5~7)
  gain: 0.42,          // amplitude falloff. < 0.5 damps the high octaves, whose flat
                       // slope spectrum is what makes isolines look jittery
  lacunarity: 2,
  baseWavelength: 560, // px of the first octave (calibrated: see NOTES.md)
  contrast: 1.5,       // linear gain around 0.5 before clamping
  framing: 'auto',     // 'auto' = pick the window with the widest relief; 'origin' = centred
  // 可选地形塑形（实验）。默认关闭 = 纯 fBm，输出与不带该参数时逐字节一致。
  //   warp:    域扭曲，让山脊连成脉络而不是各向同性的圆丘
  //   terrace: 台地化，把平缓起伏压成「平顶 + 陡崖」，等高线自然在崖壁上聚拢
  shaping: null,
};

/**
 * Deterministic camera: choose where the (infinite) map is framed.
 *
 * Feature size stays fixed in px, so a small canvas would otherwise be a single flat
 * patch with no relief. Instead we slide the sampling window over a coarse lattice and
 * keep the window with the widest height span, preferring windows closest to the origin
 * among the near-best ones. Pure function of (seed, width, height, field params):
 * the same input always frames the same ground.
 */
function pickCamera(p) {
  const { width, height, pad, coarseStep = 80 } = p;
  const radius = Math.max(2400, Math.round(Math.max(width, height) * 1.1));
  const n = Math.floor((radius * 2) / coarseStep) + 1;

  const grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      grid[j * n + i] = samplePoint(p, -radius + i * coarseStep, -radius + j * coarseStep);
    }
  }

  const winW = Math.min(n, Math.ceil((width + pad * 2) / coarseStep));
  const winH = Math.min(n, Math.ceil((height + pad * 2) / coarseStep));

  let bestSpan = -1;
  const candidates = [];
  for (let j = 0; j + winH <= n; j++) {
    for (let i = 0; i + winW <= n; i++) {
      let min = Infinity;
      let max = -Infinity;
      for (let b = j; b < j + winH; b++) {
        const row = b * n;
        for (let a = i; a < i + winW; a++) {
          const v = grid[row + a];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const span = max - min;
      if (span > bestSpan) bestSpan = span;
      candidates.push({ span, i, j });
    }
  }

  // Prefer a near-best window that sits closest to the origin.
  const threshold = bestSpan * 0.97;
  let best = null;
  for (const c of candidates) {
    if (c.span < threshold) continue;
    const cx = -radius + (c.i + winW / 2) * coarseStep;
    const cy = -radius + (c.j + winH / 2) * coarseStep;
    const dist = Math.hypot(cx, cy);
    if (!best || dist < best.dist) best = { dist, cx, cy, span: c.span };
  }
  return { cx: best ? best.cx : 0, cy: best ? best.cy : 0, span: best ? best.span : 0, radius };
}

function samplePoint(p, wx, wy) {
  const raw = fbm(wx / p.baseWavelength, wy / p.baseWavelength, p.seedInt, {
    octaves: p.octaves,
    gain: p.gain,
    lacunarity: p.lacunarity,
  });
  let h = 0.5 + (raw - 0.5) * p.contrast;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  return p.shaping ? applyShaping(h, wx, wy, p.shaping, p.seedInt) : h;
}

/** 台地化：把 [0,1] 压成 N 级平顶，级间保留一段过渡作为崖壁。 */
export function terrace(h, steps, softness) {
  const x = h * steps;
  const i = Math.floor(x);
  const f = x - i;
  const s = Math.max(1e-4, softness);
  let t = (f - (1 - s) / 2) / s;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const eased = t * t * (3 - 2 * t);
  return (i + eased) / steps;
}

/**
 * 塑形：先域扭曲（让山脊连成脉络），再台地化（平顶 + 陡崖）。
 * softness 越小崖壁越陡；steps 建议与等高线层级数同量级，让线在崖壁上成束。
 */
export function applyShaping(h, wx, wy, shaping, seedInt) {
  const { warp, terrace: terr } = { ...shaping };
  let v = h;
  if (warp) {
    const amp = warp.amp ?? 160;
    const wl = warp.wavelength ?? 1400;
    const a = Number.isFinite(warp.seedA) ? warp.seedA : 0x51ed270b;
    const b = Number.isFinite(warp.seedB) ? warp.seedB : 0x1b873593;
    // 用同一个高度场的邻域做位移，不引入额外噪声源
    const dx = fbm(wx / wl + 11.3, wy / wl + 3.7, (seedInt ^ a) | 0, { octaves: 3 }) - 0.5;
    const dy = fbm(wx / wl + 4.1, wy / wl + 19.9, (seedInt ^ b) | 0, { octaves: 3 }) - 0.5;
    v = fbm((wx + dx * amp * 2) / (warp.baseWavelength ?? 560), (wy + dy * amp * 2) / (warp.baseWavelength ?? 560), seedInt, {
      octaves: warp.octaves ?? 6,
      gain: warp.gain ?? 0.42,
      lacunarity: 2,
    });
    v = 0.5 + (v - 0.5) * (warp.contrast ?? 1.5);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  if (terr) v = terrace(v, terr.steps ?? 9, terr.softness ?? 0.22);
  return v;
}

/**
 * @returns {{cols:number, rows:number, step:number, x0:number, y0:number,
 *            data:Float32Array, min:number, max:number, width:number, height:number,
 *            pad:number, camera:object, params:object}}
 */
export function buildField(opts) {
  const p = { ...FIELD_DEFAULTS, ...opts };
  const { width, height, pad, step, octaves, gain, lacunarity, baseWavelength, contrast } = p;
  const seedInt = hashSeed(p.seed);
  const params = { ...p, seedInt };

  const camera = p.framing === 'origin' ? { cx: 0, cy: 0, span: null } : pickCamera(params);
  const x0 = camera.cx - width / 2 - pad;
  const y0 = camera.cy - height / 2 - pad;

  const cols = Math.ceil((width + pad * 2) / step) + 1;
  const rows = Math.ceil((height + pad * 2) / step) + 1;

  const data = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;

  const shaping = p.shaping;

  for (let j = 0; j < rows; j++) {
    const wy = y0 + j * step;
    const ny = wy / baseWavelength;
    const row = j * cols;
    for (let i = 0; i < cols; i++) {
      const wx = x0 + i * step;
      const nx = wx / baseWavelength;
      const raw = fbm(nx, ny, seedInt, { octaves, gain, lacunarity });
      let h = 0.5 + (raw - 0.5) * contrast;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      if (shaping) h = applyShaping(h, wx, wy, shaping, seedInt);
      data[row + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  return { cols, rows, step, x0, y0, data, min, max, width, height, pad, camera, params };
}

/** Bilinear read in world coordinates (used for reporting only). */
export function sampleField(field, wx, wy) {
  const fx = (wx - field.x0) / field.step;
  const fy = (wy - field.y0) / field.step;
  const i = Math.max(0, Math.min(field.cols - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(field.rows - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const ty = Math.max(0, Math.min(1, fy - j));
  const d = field.data;
  const r0 = j * field.cols + i;
  const r1 = r0 + field.cols;
  const a = d[r0] + (d[r0 + 1] - d[r0]) * tx;
  const b = d[r1] + (d[r1 + 1] - d[r1]) * tx;
  return a + (b - a) * ty;
}
