// 数值验收：沿一条扫描线打印亮度剖面，确认
//   1) 色带台阶出现在预期位置；
//   2) 每个色带边界上正好压着一条等高线（局部亮峰）；
//   3) 填充边缘与线条中心没有错位。
// node tools/profile.mjs <png> <row> <x0> <x1>
import { readFileSync } from 'node:fs';
import { decodePng } from './png-read.mjs';

const [file, row, x0, x1] = process.argv.slice(2);
const img = decodePng(readFileSync(file));
const Y = +row;
const X0 = +x0;
const X1 = +x1;

const lum = (i) => {
  const s = (Y * img.width + i) * img.channels;
  return (img.data[s] * 0.2126 + img.data[s + 1] * 0.7152 + img.data[s + 2] * 0.0722);
};

const vals = [];
for (let x = X0; x <= X1; x++) vals.push({ x, l: lum(x) });

// 台阶：与左侧邻域的差超过 1.0
const steps = [];
let i = 2;
while (i < vals.length - 2) {
  const left = (vals[i - 1].l + vals[i - 2].l) / 2;
  const right = (vals[i + 1].l + vals[i + 2].l) / 2;
  if (Math.abs(right - left) > 1.0) {
    steps.push({ x: vals[i].x, delta: +(right - left).toFixed(2) });
    i += 3;
  } else i++;
}

// 线：局部极大值，且比左右 6px 邻域高 3 以上
const peaks = [];
for (let k = 6; k < vals.length - 6; k++) {
  const v = vals[k].l;
  if (v - vals[k - 6].l > 3 && v - vals[k + 6].l > 3 && v >= vals[k - 1].l && v >= vals[k + 1].l) {
    peaks.push({ x: vals[k].x, lum: +v.toFixed(1), rise: +(v - Math.min(vals[k - 6].l, vals[k + 6].l)).toFixed(1) });
    k += 4;
  }
}

console.log(JSON.stringify({ file, row: Y, range: [X0, X1], stepCount: steps.length, steps, peakCount: peaks.length, peaks }, null, 2));
