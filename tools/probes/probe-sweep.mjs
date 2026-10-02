// Throwaway probe: parameter sweep for base wavelength / contrast / octaves.
// Acceptance target: every viewport shows most of the 9 levels, and 1440x1000 keeps a
// readable spacing (55~95 px) at 9 levels.
import { buildField } from '../../src/field.mjs';
import { extractIsolines } from '../../src/marching.mjs';
import { levelsFor, medianContourSpacing } from '../../src/measure.mjs';

const SIZES = [
  [1440, 1000],
  [2560, 1440],
  [390, 844],
];

const candidates = [];
for (const baseWavelength of [420, 560, 700]) {
  for (const contrast of [1.1, 1.35, 1.6]) {
    candidates.push({ baseWavelength, contrast, octaves: 6 });
  }
}

for (const cand of candidates) {
  const row = { ...cand, sizes: [] };
  for (const [w, h] of SIZES) {
    const field = buildField({ width: w, height: h, seed: 'isopleth-01', ...cand });
    let nonEmpty = 0;
    let totalKept = 0;
    for (const level of levelsFor(9)) {
      const { stats } = extractIsolines(field, level);
      if (stats.kept > 0) nonEmpty++;
      totalKept += stats.kept;
    }
    const sp = medianContourSpacing(field, 9, { scanlines: 31 });
    row.sizes.push({
      size: `${w}x${h}`,
      min: +field.min.toFixed(3),
      max: +field.max.toFixed(3),
      levelsNonEmpty: `${nonEmpty}/9`,
      paths: totalKept,
      medianGap: sp.median === null ? null : +sp.median.toFixed(0),
      p10: sp.p10 === null ? null : +sp.p10.toFixed(0),
      p90: sp.p90 === null ? null : +sp.p90.toFixed(0),
    });
  }
  console.log(JSON.stringify(row));
}
