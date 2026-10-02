// Throwaway: inspect the water rings at 390x844 — closed? nested? how much area?
import { generateTerrainSvg } from '../src/node.mjs';
import { levelsFor } from '../src/measure.mjs';
import { extractBandPolygons } from '../src/marching.mjs';

const W = 390;
const H = 844;
const gen = generateTerrainSvg({ width: W, height: H, seed: 'isopleth-01', levels: levelsFor(9), water: { level: 0.3 } });
const { paths } = extractBandPolygons(gen.field, -Infinity, 0.3, { minRingExtent: 21 });

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

const rings = paths.map((p) => ({
  closed: p.closed,
  points: p.points.length,
  extent: +p.extent.toFixed(0),
  signedArea: +area(p.points).toFixed(0),
  absArea: +Math.abs(area(p.points)).toFixed(0),
}));

const sumAbs = rings.reduce((s, r) => s + r.absArea, 0);
const sumSigned = rings.reduce((s, r) => s + r.signedArea, 0);
console.log(JSON.stringify({
  ringCount: rings.length,
  openRings: rings.filter((r) => !r.closed).length,
  sumAbsAreaPercent: +((sumAbs / (W * H)) * 100).toFixed(2),
  sumSignedAreaPercent: +((Math.abs(sumSigned) / (W * H)) * 100).toFixed(2),
  viewportPercent: 100,
  rings: rings.sort((a, b) => b.absArea - a.absArea).slice(0, 12),
}, null, 2));
