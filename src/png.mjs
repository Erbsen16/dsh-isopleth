// 平台无关的 PNG 组装。
//
// 只做分块与 CRC，**deflate 由调用方注入**：
//   Node      -> node:zlib 的 deflateSync（同步）
//   浏览器     -> CompressionStream('deflate')（返回 Promise）
// 因此同一个函数既能同步也能异步：注入的 deflate 返回 Promise 时，这里也返回 Promise。
//
// 这个文件不 import 任何宿主 API，可以在渲染进程里直接跑。

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function chunk(type, data) {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const crc = crc32(body);
  // 分块 = 4 长度 + body(4 类型 + N 数据) + 4 CRC
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc, false);
  return out;
}

const COLOR_TYPE = { 1: 0, 2: 2, 3: 2, 4: 6 };

/** 把像素行加上 PNG 的 filter 字节（0 = None）。 */
export function pngRawScanlines(width, height, pixels, channels) {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return raw;
}

/**
 * @param {(raw:Uint8Array)=>Uint8Array|Promise<Uint8Array>} deflate
 * @returns {Uint8Array|Promise<Uint8Array>}
 */
export function pngBytes(width, height, pixels, channels, deflate) {
  const colorType = COLOR_TYPE[channels];
  if (colorType === undefined) throw new Error(`unsupported channel count: ${channels}`);

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = colorType;

  const raw = pngRawScanlines(width, height, pixels, channels);
  const finish = (deflated) =>
    concat([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflated),
      chunk('IEND', new Uint8Array(0)),
    ]);

  const out = deflate(raw);
  return out && typeof out.then === 'function' ? out.then(finish) : finish(out);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Node 与浏览器通用（不依赖 Buffer / btoa 的差异：都手写一遍）。 */
export function bytesToBase64(bytes) {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < n ? bytes[i + 1] : 0;
    const b2 = i + 2 < n ? bytes[i + 2] : 0;
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < n ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < n ? B64[b2 & 63] : '=';
  }
  return out;
}
