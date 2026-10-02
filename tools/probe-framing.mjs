// Throwaway probe: how much height range can a given viewport actually contain, if we
// are free to choose where the map is framed (deterministic camera, fixed px density)?
import { fbm, hashSeed } from '../src/noise.mjs';

const seedInt = hashSeed('isopleth-01');
const FIELD = { octaves: 6, gain: 0.42, lacunarity: 2, baseWavelength: 560, contrast: 1.5 };

const height = (x, y) => {
  const raw = fbm(x / FIELD.baseWavelength, y / FIELD.baseWavelength, seedInt, FIELD);
  const h = 0.5 + (raw - 0.5) * FIELD.contrast;
  return h < 0 ? 0 : h > 1 ? 1 : h;
};

const step = 40;
const half = 2600;
const n = Math.floor((half * 2) / step) + 1;
const grid = new Float32Array(n * n);
for (let j = 0; j < n; j++) {
  for (let i = 0; i < n; i++) {
    grid[j * n + i] = height(-half + i * step, -half + j * step);
  }
}

const viewports = [
  { name: '1440x1000', w: 1440, h: 1000 },
  { name: '2560x1440', w: 2560, h: 1440 },
  { name: '390x844', w: 390, h: 844 },
];

for (const vp of viewports) {
  const pad = 64;
  const winW = Math.ceil((vp.w + pad * 2) / step);
  const winH = Math.ceil((vp.h + pad * 2) / step);
  let best = null;
  for (let j = 0; j + winH <= n; j++) {
    for (let i = 0; i + winW <= n; i++) {
      let min = Infinity;
      let max = -Infinity;
      let inside = 0;
      for (let b = j; b < j + winH; b++) {
        const row = b * n;
        for (let a = i; a < i + winW; a++) {
          const v = grid[row + a];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      for (let k = 1; k <= 9; k++) {
        const level = k / 10;
        if (level > min && level < max) inside++;
      }
      const span = max - min;
      if (!best || span > best.span) {
        best = {
          span: +span.toFixed(3),
          min: +min.toFixed(3),
          max: +max.toFixed(3),
          levelsInside: inside,
          cx: -half + (i + winW / 2) * step,
          cy: -half + (j + winH / 2) * step,
        };
      }
    }
  }
  console.log(JSON.stringify({ viewport: vp.name, winPx: [winW * step, winH * step], best }));
}
