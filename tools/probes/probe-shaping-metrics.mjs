// Throwaway: 台地化对「量化表硬指标」的影响——间距是否还在 40~90px 带内、水面占比。
import { buildField } from '../../src/field.mjs';
import { medianContourSpacing } from '../../src/measure.mjs';
import { levelsFor } from '../../src/measure.mjs';
import { waterSampleFraction } from '../../src/water.mjs';

const levels = levelsFor(9);
const variants = [
  { name: 'A-baseline-fbm', field: {}, water: 0.3 },
  { name: 'B-terrace9', field: { shaping: { terrace: { steps: 9, softness: 0.22 } } }, water: 0.3 },
  { name: 'C-terrace5', field: { shaping: { terrace: { steps: 5, softness: 0.2 } } }, water: 0.3 },
  { name: 'D-warp-terrace5', field: { shaping: { warp: { amp: 160, wavelength: 1400 }, terrace: { steps: 5, softness: 0.2 } } }, water: 0.3 },
  { name: 'B2-terrace9-water0.22', field: { shaping: { terrace: { steps: 9, softness: 0.22 } } }, water: 2 / 9 },
];

for (const v of variants) {
  const f = buildField({ width: 1440, height: 1000, seed: 'isopleth-01', ...v.field });
  const sp = medianContourSpacing(f, 9, { scanlines: 41 });
  // 间距分布有多「双峰」：p10 / 中位 / p90
  const inBand = sp.median >= 40 && sp.median <= 90;
  console.log(JSON.stringify({
    variant: v.name,
    waterLevel: +v.water.toFixed(3),
    waterPercent: +(waterSampleFraction(f, v.water) * 100).toFixed(1),
    gapMedian: +sp.median.toFixed(1),
    gapP10: +sp.p10.toFixed(1),
    gapP90: +sp.p90.toFixed(1),
    spread: +(sp.p90 / sp.p10).toFixed(1),
    inBand,
  }));
}
