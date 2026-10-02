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
  return h < 0 ? 0 : h > 1 ? 1 : h;
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

  for (let j = 0; j < rows; j++) {
    const ny = (y0 + j * step) / baseWavelength;
    const row = j * cols;
    for (let i = 0; i < cols; i++) {
      const nx = (x0 + i * step) / baseWavelength;
      const raw = fbm(nx, ny, seedInt, { octaves, gain, lacunarity });
      let h = 0.5 + (raw - 0.5) * contrast;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
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
