// Probe: extractMultiIsolines (one sweep, all levels) must match per-level extractIsolines exactly.
import { buildField } from '../../src/field.mjs';
import { extractIsolines, extractMultiIsolines } from '../../src/marching.mjs';
import { levelsFor } from '../../src/measure.mjs';

const field = buildField({ width: 1440, height: 1000, seed: 'isopleth-01' });
let ok = true;

for (const n of [9, 18, 36]) {
  const levels = levelsFor(n);
  const t0 = performance.now();
  const naive = levels.map((L) => extractIsolines(field, L));
  const t1 = performance.now();
  const multi = extractMultiIsolines(field, levels);
  const t2 = performance.now();

  let same = true;
  for (let k = 0; k < levels.length; k++) {
    const a = naive[k].paths.map((p) => p.points.map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)}`).join(' ')).join('|');
    const b = multi[k].paths.map((p) => p.points.map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)}`).join(' ')).join('|');
    if (a !== b) { same = false; break; }
  }
  ok = ok && same;
  console.log(JSON.stringify({
    levels: n,
    perLevelMs: Math.round(t1 - t0),
    singleSweepMs: Math.round(t2 - t1),
    speedup: `${((t1 - t0) / Math.max(0.01, t2 - t1)).toFixed(1)}x`,
    identical: same,
  }));
}
console.log(ok ? 'ALL IDENTICAL' : 'MISMATCH');
process.exit(ok ? 0 : 1);
