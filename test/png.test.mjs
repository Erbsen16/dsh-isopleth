import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pngBytes, bytesToBase64, crc32 } from '../src/png.mjs';
import { encodePng as encodePngNode } from '../tools/png.mjs';
import { decodePng } from '../tools/png-read.mjs';

/** 造一张有梯度 + 硬边的测试图，避免压缩器把整张图压成常数。 */
function sampleRgba(w, h) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (w / 3) ** 2;
      px[i] = inside ? 255 : x % 256;
      px[i + 1] = inside ? 255 : y % 256;
      px[i + 2] = (x + y) % 256;
      px[i + 3] = inside ? 40 : 200;
    }
  }
  return px;
}

test('Node 编码器产出的 PNG 能被自写解码器原样读回', () => {
  const w = 37;
  const h = 23;
  const px = sampleRgba(w, h);
  const png = encodePngNode(w, h, px, 4);
  const img = decodePng(Buffer.from(png));
  assert.equal(img.width, w);
  assert.equal(img.height, h);
  assert.equal(img.channels, 4);
  assert.deepEqual(Array.from(img.data), Array.from(px), '像素应逐字节一致');
});

test('浏览器编码器（CompressionStream）与 Node 编码器像素一致', async () => {
  const w = 41;
  const h = 19;
  const px = sampleRgba(w, h);

  const nodePng = encodePngNode(w, h, px, 4);

  // Node 18+ 有全局 CompressionStream，可以直接走浏览器那条路径
  const browserPng = await pngBytes(w, h, px, 4, async (raw) => {
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  });

  const a = decodePng(Buffer.from(nodePng));
  const b = decodePng(Buffer.from(browserPng));
  assert.deepEqual(Array.from(b.data), Array.from(a.data), '两条编码路径像素必须一致');
  // 压缩字节不要求相同（zlib 与 CompressionStream 实现不同），但必须都是合法 PNG
  assert.equal(b.width, w);
  assert.equal(b.height, h);
});

test('灰度图（1 通道）也能往返', () => {
  const w = 16;
  const h = 16;
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = (i * 7) % 256;
  const img = decodePng(Buffer.from(encodePngNode(w, h, px, 1)));
  assert.equal(img.channels, 1);
  assert.deepEqual(Array.from(img.data), Array.from(px));
});

test('PNG 分块结构正确：IHDR/IDAT/IEND，长度字段与实际一致', () => {
  const png = Buffer.from(encodePngNode(8, 8, new Uint8Array(8 * 8 * 3), 3));
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'PNG 魔数');
  const types = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    types.push({ type, len, total: 12 + len });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  assert.deepEqual(types.map((t) => t.type), ['IHDR', 'IDAT', 'IEND']);
  assert.equal(types[0].len, 13);
  assert.equal(off, png.length, '分块长度必须刚好铺满文件（曾因多分配 4 字节导致错位）');
});

test('base64 编码与 Buffer 一致（含补位）', () => {
  for (const n of [1, 2, 3, 4, 5, 31, 100]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 37) % 256;
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'), `长度 ${n}`);
  }
});

test('crc32 对已知输入稳定', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
