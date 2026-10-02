// Step CLI 共用小工具。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { encodePng } from '../tools/png.mjs';
import { decodePng } from '../tools/png-read.mjs';

export function argOf(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

export function parseSizes(spec) {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [w, h] = s.split('x').map(Number);
      return { w, h };
    });
}

/** 从一张 PNG 里裁一块 1:1 原生像素出来（判断观感必须按像素看，缩放过的预览会骗人）。 */
export function cropFrom(pngPath, outPath, rect) {
  const src = decodePng(readFileSync(pngPath));
  const buf = Buffer.alloc(rect.w * rect.h * 3);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const s = ((y + rect.y) * src.width + (x + rect.x)) * src.channels;
      const d = (y * rect.w + x) * 3;
      buf[d] = src.data[s];
      buf[d + 1] = src.data[s + 1];
      buf[d + 2] = src.data[s + 2];
    }
  }
  mkdirSync(join(outPath, '..'), { recursive: true });
  writeFileSync(outPath, encodePng(rect.w, rect.h, buf, 3));
  return outPath;
}
