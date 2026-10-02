// Step 6 CLI：按分层参数方案（主线/辅线/属性线/断裂/标注 + 叠加材质）出图。
//
//   node steps/step6-atlas.mjs                                  # 1440x1000
//   node steps/step6-atlas.mjs --size 2560x1440 --seed ridge-07
//   node steps/step6-atlas.mjs --cards "120,760,420,180"        # 卡片下方等高线淡出
//
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTerrain } from '../src/generate.mjs';
import { renderAtlas, ATLAS_DEFAULTS } from '../src/atlas.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';
import { rasterizeSvg } from '../tools/rasterize.mjs';
import { argOf, parseSizes } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');

const args = process.argv.slice(2);
const seed = argOf(args, 'seed', 'isopleth-01');
const INTERVALS = Number(argOf(args, 'intervals', String(ATLAS_DEFAULTS.intervals)));
const ELEV_STEP = Number(argOf(args, 'elevStep', String(ATLAS_DEFAULTS.elevationStep)));
const GROUND = argOf(args, 'ground', '#14171a');
const CARDS = argOf(args, 'cards', '');
const PREVIEW = argOf(args, 'preview', '1') !== '0';
const sizes = parseSizes(argOf(args, 'size', '1440x1000'));

const fade = CARDS
  ? {
      rects: CARDS.split(';').map((s) => {
        const [x, y, w, h] = s.split(',').map(Number);
        return { x, y, w, h };
      }),
    }
  : null;

const report = { seed, intervals: INTERVALS, elevationStep: ELEV_STEP, ground: GROUND, fade, sizes: [] };

for (const { w, h } of sizes) {
  const dir = join(OUT, 'step6-atlas');
  mkdirSync(dir, { recursive: true });

  const terrain = buildTerrain({
    width: w,
    height: h,
    seed,
    levels: levelsFor(INTERVALS),
    bands: null,       // 分层方案里没有色带填充层
    lighting: null,    // 也没有山体阴影层
    water: null,       // 水面在这里是「属性线颜色」不是填充
  });

  const { svg, stats } = renderAtlas(terrain, { ground: GROUND, intervals: INTERVALS, elevationStep: ELEV_STEP, fade });
  const svgPath = join(dir, `atlas-${w}x${h}.svg`);
  writeFileSync(svgPath, svg, 'utf8');

  let png = null;
  if (PREVIEW) png = rasterizeSvg(svgPath, join(dir, `atlas-${w}x${h}.png`), w, h);

  const sp = medianContourSpacing(terrain.field, INTERVALS);
  report.sizes.push({
    size: `${w}x${h}`,
    svg: svgPath,
    png,
    svgKB: +(statSync(svgPath).size / 1024).toFixed(1),
    stats,
    spacing: { median: +sp.median.toFixed(1), p10: +sp.p10.toFixed(1), p90: +sp.p90.toFixed(1) },
    timings: { geometryMs: +terrain.timings.geometryMs.toFixed(1) },
  });
}

const reportPath = join(OUT, `step6-report-${seed}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

// 生成一遍 SVG 供默认尺寸使用（上面的循环里已写盘）
console.log(`report -> ${reportPath}`);
for (const s of report.sizes) {
  console.log(
    [
      s.size.padEnd(10),
      `svg ${String(s.svgKB).padStart(6)}KB`,
      `主线 ${s.stats.majorLines} / 辅线 ${s.stats.minorLines}`,
      `属性线 暖 ${s.stats.warmSegments} 段 / 冷 ${s.stats.coolSegments} 段`,
      `标注 ${s.stats.markers}`,
      `间距 ${s.spacing.median}px (p10 ${s.spacing.p10} / p90 ${s.spacing.p90})`,
      `耗时 ${s.timings.geometryMs}ms`,
    ].join(' | '),
  );
}
