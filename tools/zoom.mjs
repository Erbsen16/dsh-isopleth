// Diagnostic zoom: nearest-neighbour enlargement of a region of a PNG.
// node tools/zoom.mjs <src.png> <x> <y> <w> <h> <scale> <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng } from './png-read.mjs';
import { encodePng } from './png.mjs';

const [src, x, y, w, h, scale, out] = process.argv.slice(2);
const X = +x, Y = +y, W = +w, H = +h, S = +scale;

const img = decodePng(readFileSync(src));
const buf = Buffer.alloc(W * S * H * S * 3);
for (let j = 0; j < H * S; j++) {
  for (let i = 0; i < W * S; i++) {
    const s = ((Y + Math.floor(j / S)) * img.width + (X + Math.floor(i / S))) * img.channels;
    const d = (j * W * S + i) * 3;
    buf[d] = img.data[s];
    buf[d + 1] = img.data[s + 1];
    buf[d + 2] = img.data[s + 2];
  }
}
writeFileSync(out, encodePng(W * S, H * S, buf, 3));
console.log(out, `${W * S}x${H * S}`);
