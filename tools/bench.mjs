// Timing benchmark: N levels at the spec target size (default 1600x1000).
// Run: node tools/bench.mjs [width] [height] [levelCount] [runs] [bandCount] [light 0|1]
import { generateTerrainSvg } from '../src/generate.mjs';
import { levelsFor } from '../src/measure.mjs';

const [w = 1600, h = 1000, levelCount = 9, runs = 3, bandCount = 0, light = 0] = process.argv.slice(2).map(Number);
const levels = levelsFor(levelCount);
const bands = bandCount > 0 ? { bandCount, contourLevels: levels } : null;
const lighting = light ? true : null;

const times = [];
let bytes = 0;
// 先跑一次预热（JIT / 堆增长），再计时，否则首个数字会虚高 60%+
generateTerrainSvg({ width: w, height: h, seed: 'isopleth-01', levels, bands, lighting });

for (let r = 0; r < runs; r++) {
  const t = process.hrtime.bigint();
  const gen = generateTerrainSvg({ width: w, height: h, seed: 'isopleth-01', levels, bands, lighting });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  times.push(ms);
  bytes = Buffer.byteLength(gen.svg, 'utf8');
  if (r === 0) {
    console.log(
      JSON.stringify({
        size: `${w}x${h}`,
        levels: levelCount,
        bands: bandCount,
        camera: gen.camera,
        fieldSamples: gen.field.cols * gen.field.rows,
        fieldMs: +gen.timings.fieldMs.toFixed(1),
        bandsMs: +gen.timings.bandsMs.toFixed(1),
        isolineMs: +gen.timings.isolineMs.toFixed(1),
        svgMs: +gen.timings.svgMs.toFixed(2),
        internalTotalMs: +gen.timings.totalMs.toFixed(1),
        paths: gen.stats.kept,
        vertices: gen.stats.verticesAfterSimplify,
      }),
    );
  }
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    runs,
    min: +times[0].toFixed(1),
    median: +times[Math.floor(runs / 2)].toFixed(1),
    max: +times[runs - 1].toFixed(1),
    svgKB: +(bytes / 1024).toFixed(1),
  }),
);
