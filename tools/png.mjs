// Node 侧的 PNG 编码器：注入 node:zlib 的 deflateSync 到平台无关的 src/png.mjs。
// 浏览器侧用 src/browser.mjs 的 CompressionStream 版本，两者产出同一张图。

import { deflateSync } from 'node:zlib';
import { pngBytes } from '../src/png.mjs';

const deflate = (raw) => new Uint8Array(deflateSync(raw, { level: 9 }));

/** @param {Uint8Array} pixels width*height*channels */
export function encodePng(width, height, pixels, channels = 1) {
  return pngBytes(width, height, pixels, channels, deflate);
}

export { deflate };
