// 两段式风格化 CLI。
//
//   第一段：buildTerrain —— 结构（高度场 / 色带 / 等高线 / 归一化明暗）
//   第二段：styleTerrain —— 皮肤（底色 / 线色 / 线对比 / 明暗强度）
//
//   node steps/step5-style.mjs                       # 出 base(量化表) 与 survey(参考图风) 两版
//   node steps/step5-style.mjs --style survey --sizes 1440x1000
//   node steps/step5-style.mjs --measure 1           # 顺带用像素反解线对比，和参考图对账
//
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTerrain, renderSvg } from '../src/generate.mjs';
import { encodePngNode } from '../src/node.mjs';
import { styleTerrain, STYLE_PRESETS } from '../src/style.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';
import { decodePng } from '../tools/png-read.mjs';
import { lineStats } from '../tools/line-stats.mjs';
import { rasterizeSvg } from '../tools/rasterize.mjs';
import { argOf, parseSizes, cropFrom } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out');

const args = process.argv.slice(2);
const seed = argOf(args, 'seed', 'isopleth-01');
const LEVEL_COUNT = Number(argOf(args, 'levels', '9'));
const BAND_COUNT = Number(argOf(args, 'bands', '5'));
const STYLE = argOf(args, 'style', 'all');
const MEASURE = argOf(args, 'measure', '1') === '1';
const PREVIEW = argOf(args, 'preview', '1') !== '0';
const sizes = parseSizes(argOf(args, 'sizes', '1440x1000,2560x1440,390x844'));

const levels = levelsFor(LEVEL_COUNT);
const CROP = { x: 200, y: 300, w: 720, h: 460 };

const presetNames = STYLE === 'all' ? ['spec', 'survey', 'survey-water'] : [STYLE];
const report = { seed, levels: LEVEL_COUNT, bandCount: BAND_COUNT, styles: {} };

for (const name of presetNames) {
  const preset = STYLE_PRESETS[name];
  if (!preset) throw new Error(`未知预设 ${name}（可选：${Object.keys(STYLE_PRESETS).join(', ')}）`);

  report.styles[name] = { label: preset.label, sizes: [] };
  for (const { w, h } of sizes) {
    const dir = join(OUT, `step5-${name}`);
    mkdirSync(dir, { recursive: true });

    // —— 第一段：结构（明暗归一化，强度留给第二段）——
    const base = buildTerrain({
      width: w, height: h, seed, levels,
      bands: { bandCount: BAND_COUNT, contourLevels: levels },
      lighting: { normalize: true },
      water: true,
    });
    // —— 第二段：皮肤 ——
    const terrain = styleTerrain(base, preset);
    const svgPath = join(dir, `terrain-${w}x${h}.svg`);
    writeFileSync(svgPath, renderSvg(terrain, { encodePng: encodePngNode }), 'utf8');

    let png = null, crop = null, stats = null, dpr2 = null;
    if (PREVIEW) {
      png = rasterizeSvg(svgPath, join(dir, `terrain-${w}x${h}.png`), w, h);
      if (w === 1440) {
        crop = cropFrom(png, join(dir, `crop1to1-${w}x${h}.png`), CROP);
        dpr2 = rasterizeSvg(svgPath, join(dir, `terrain-${w}x${h}@2x.png`), w, h, { dpr: 2 });
        if (MEASURE) stats = lineStats(png);
      }
    }

    const spacing = medianContourSpacing(base.field, LEVEL_COUNT);
    report.styles[name].sizes.push({
      size: `${w}x${h}`,
      svg: svgPath,
      svgKB: +(statSync(svgPath).size / 1024).toFixed(1),
      bandCount: BAND_COUNT,
      spacingMedian: +spacing.median.toFixed(1),
      lineStats: stats,
      timings: {}, // 两段合计见下
      crop,
      dpr2,
    });
  }
}

const reportPath = join(OUT, `step5-report-${seed}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`report -> ${reportPath}`);
console.log('参考图实测基准：底色 L52 / 线 L106 / 线比底亮 +54 / 线色 #696b6b / 覆盖率 6.06%');
for (const [name, s] of Object.entries(report.styles)) {
  for (const r of s.sizes) {
    const l = r.lineStats;
    console.log(
      [
        name.padEnd(7),
        r.size.padEnd(10),
        `svg ${String(r.svgKB).padStart(6)}KB`,
        `间距 ${r.spacingMedian}px`,
        l ? `底色 ${l.底色}(${l.底色亮度})` : '',
        l ? `线 ${l.线色}(${l.线亮度})` : '',
        l ? `线比底亮 ${l['线比底亮']}` : '',
        l ? `覆盖 ${l.线覆盖率}` : '',
      ].join(' | '),
    );
  }
}
