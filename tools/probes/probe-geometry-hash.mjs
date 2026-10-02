// 打印几何快照哈希（去掉 data-* 元信息后的 SHA-256），用于 generate.test.mjs 的回归闸门。
import { generateTerrainSvg } from '../../src/node.mjs';
import { levelsFor } from '../../src/measure.mjs';
import { createHash } from 'node:crypto';

const levels = levelsFor(9);
const { svg } = generateTerrainSvg({
  width: 1440,
  height: 1000,
  seed: 'isopleth-01',
  levels,
  bands: { bandCount: 5, lightenStep: 0.05, contourLevels: levels },
  lighting: true,
  water: { level: 0.3 },
});
const geo = svg.replace(/ data-[a-z-]+="[^"]*"/g, '');
console.log(createHash('sha256').update(geo).digest('hex').toUpperCase());
