// Throwaway probe: raw fBm statistics (mean / sigma / range) to calibrate the
// height mapping. Run: node tools/probe-stats.mjs
import { fbm, hashSeed } from '../src/noise.mjs';

const seedInt = hashSeed('isopleth-01');
for (const octaves of [5, 6, 7]) {
  for (const wavelength of [420, 620, 900]) {
    let n = 0, sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
    let gsum = 0, gcount = 0;
    const step = 3;
    for (let y = -1200; y <= 1200; y += step) {
      let prev = null;
      for (let x = -1200; x <= 1200; x += step) {
        const v = fbm(x / wavelength, y / wavelength, seedInt, { octaves, gain: 0.5, lacunarity: 2 });
        n++; sum += v; sum2 += v * v;
        if (v < min) min = v;
        if (v > max) max = v;
        if (prev !== null) { gsum += Math.abs(v - prev) / step; gcount++; }
        prev = v;
      }
    }
    const mean = sum / n;
    const sd = Math.sqrt(sum2 / n - mean * mean);
    const g = gsum / gcount;
    console.log(
      JSON.stringify({
        octaves, wavelength,
        mean: +mean.toFixed(4), sd: +sd.toFixed(4),
        min: +min.toFixed(4), max: +max.toFixed(4),
        meanGradPerPx: +g.toFixed(6),
        impliedSpacingPx_interval0_1: +(0.1 / g).toFixed(1),
      }),
    );
  }
}
