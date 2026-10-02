#!/usr/bin/env node
// hypsa-isopleth CLI —— 一条命令出一张地形底纹 SVG。
//
//   npx hypsa-isopleth --seed ridge-07 --size 1440x1000 > terrain.svg
//   npx hypsa-isopleth --style survey --size 2560x1440 --out hero.svg
//   npx hypsa-isopleth --style none --bands 0 --report          # 只要等高线
//
// 只依赖 Node 标准库。SVG 写 stdout（或 --out），实测指标写 stderr。

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { buildTerrain, renderSvg, GEN_DEFAULTS } from '../src/generate.mjs';
import { encodePngNode } from '../src/node.mjs';
import { styleTerrain, STYLE_PRESETS } from '../src/style.mjs';
import { levelsFor, medianContourSpacing } from '../src/measure.mjs';

const HELP = `hypsa-isopleth —— 零依赖程序化地形底纹生成器

用法
  hypsa-isopleth [options]

选项
  --seed <s>        地形种子（默认 ${GEN_DEFAULTS.seed}）
  --size <WxH>      尺寸（默认 ${GEN_DEFAULTS.width}x${GEN_DEFAULTS.height}）
  --style <name>    风格预设：${Object.keys(STYLE_PRESETS).join(' | ')} | none（默认 survey）
  --levels <n>      等高线条数（默认 9）
  --bands <n>       色带级数，0 = 不填色带（默认 5）
  --lighten <f>     色带每级白叠加量（默认 0.05）
  --water <f>       水面高度阈值，0 = 不出水面（默认 0）
  --out <file>      写入文件；缺省写 stdout
  --report          把实测指标写到 stderr
  --help            显示本帮助

例
  hypsa-isopleth --seed ridge-07 --size 1440x1000 > terrain.svg
  hypsa-isopleth --style spec --size 2560x1440 --out hero.svg
`;

function fail(msg) {
  process.stderr.write(`hypsa-isopleth: ${msg}\n\n${HELP}`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      seed: { type: 'string' },
      size: { type: 'string' },
      style: { type: 'string' },
      levels: { type: 'string' },
      bands: { type: 'string' },
      lighten: { type: 'string' },
      water: { type: 'string' },
      out: { type: 'string' },
      report: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
} catch (e) {
  fail(e.message);
}

const v = parsed.values;
if (v.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const size = v.size ?? `${GEN_DEFAULTS.width}x${GEN_DEFAULTS.height}`;
const m = /^(\d+)x(\d+)$/.exec(size);
if (!m) fail(`--size 必须是 WxH，收到 "${size}"`);
const width = Number(m[1]);
const height = Number(m[2]);
if (!(width > 0 && height > 0)) fail('尺寸必须为正');

const levels = Number(v.levels ?? 9);
if (!Number.isInteger(levels) || levels < 1) fail('--levels 必须是正整数');

const bandCount = Number(v.bands ?? 5);
if (!Number.isInteger(bandCount) || bandCount < 0) fail('--bands 必须是非负整数');

const lighten = Number(v.lighten ?? 0.05);
if (!Number.isFinite(lighten) || lighten < 0) fail('--lighten 必须是非负数');

const waterLevel = Number(v.water ?? 0);
if (!Number.isFinite(waterLevel) || waterLevel < 0 || waterLevel > 1) fail('--water 必须在 0~1');

const styleName = v.style ?? 'survey';
if (styleName !== 'none' && !STYLE_PRESETS[styleName]) {
  fail(`--style 只能是 ${Object.keys(STYLE_PRESETS).join(' / ')} / none`);
}

const contourLevels = levelsFor(levels);
const terrain = buildTerrain({
  width,
  height,
  seed: v.seed ?? GEN_DEFAULTS.seed,
  levels: contourLevels,
  bands: bandCount > 0 ? { bandCount, lightenStep: lighten, contourLevels } : null,
  // 有风格层时必须用归一化明暗，强度交给风格层决定
  lighting: { normalize: true },
  water: waterLevel > 0 ? { level: waterLevel } : null,
});

const finalTerrain = styleName === 'none' ? terrain : styleTerrain(terrain, styleName);
const svg = renderSvg(finalTerrain, { encodePng: encodePngNode });

if (v.out) {
  writeFileSync(v.out, svg, 'utf8');
  process.stderr.write(`hypsa-isopleth: 写入 ${v.out}（${(Buffer.byteLength(svg, 'utf8') / 1024).toFixed(1)} KB）\n`);
} else {
  process.stdout.write(svg);
}

if (v.report) {
  const sp = medianContourSpacing(terrain.field, levels);
  process.stderr.write(
    [
      `  尺寸      ${width}x${height}`,
      `  种子      ${v.seed ?? GEN_DEFAULTS.seed}`,
      `  风格      ${styleName}`,
      `  等高线    ${levels} 条${bandCount > 0 ? ` / 色带 ${bandCount} 级` : ' / 无色带'}`,
      `  中位间距  ${sp.median.toFixed(1)} px（p10 ${sp.p10.toFixed(1)} / p90 ${sp.p90.toFixed(1)}）`,
      `  体积      ${(Buffer.byteLength(svg, 'utf8') / 1024).toFixed(1)} KB`,
      '',
    ].join('\n'),
  );
}
