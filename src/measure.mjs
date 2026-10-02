// Measured contour spacing: along horizontal scanlines, collect every crossing of every
// level, then take the gaps between consecutive crossings. That gap is literally the
// on-screen distance between two neighbouring drawn contour lines.

import { extractIsolines } from './marching.mjs';

export function levelsFor(count) {
  const out = [];
  for (let k = 1; k <= count; k++) out.push(k / (count + 1));
  return out;
}

export function medianContourSpacing(field, levelCount, { scanlines = 41 } = {}) {
  const levels = levelsFor(levelCount);
  const { cols, rows, step, data } = field;
  const gaps = [];
  const rowsUsed = Math.max(2, Math.min(rows, scanlines));
  const levelSet = levels.slice().sort((a, b) => a - b);

  for (let s = 0; s < rowsUsed; s++) {
    const j = Math.floor(((s + 0.5) * rows) / rowsUsed);
    if (j < 0 || j >= rows) continue;
    const row = j * cols;
    const xs = [];
    for (let i = 0; i < cols - 1; i++) {
      const a = data[row + i];
      const b = data[row + i + 1];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (const level of levelSet) {
        if (level >= lo && level < hi) {
          const t = (level - a) / (b - a);
          xs.push((i + t) * step);
        }
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 1; k < xs.length; k++) {
      const gap = xs[k] - xs[k - 1];
      if (gap > 0.5) gaps.push(gap);
    }
  }

  if (!gaps.length) return { median: null, p10: null, p90: null, samples: 0, levels };
  gaps.sort((a, b) => a - b);
  const pick = (q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))];
  return {
    median: pick(0.5),
    p10: pick(0.1),
    p90: pick(0.9),
    mean: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    samples: gaps.length,
    levels,
  };
}

/** Levels that actually produce geometry, for reporting. */
export function levelCoverage(field, levelCount) {
  const out = [];
  for (const level of levelsFor(levelCount)) {
    const { stats } = extractIsolines(field, level);
    out.push({ level, kept: stats.kept, rings: stats.rings, open: stats.open, length: stats.totalLength });
  }
  return out;
}
