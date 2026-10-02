// Throwaway probe: hillshade calibration. Prints the distribution of the normalised
// shading amount so the default is chosen from numbers, not from taste.
import { buildField } from '../src/field.mjs';
import { buildHillshade } from '../src/hillshade.mjs';
import { encodePng } from './png.mjs';

const field = buildField({ width: 1440, height: 1000, seed: 'isopleth-01' });

/** 重算一遍 t 分布（与 hillshade 内部同式），用于校准。 */
function distribution(field, o) {
  const { cols, step, pad, data } = field;
  const inset = Math.round(pad / step);
  const s = o.stride;
  const off = Math.max(1, Math.round(o.gradientRadiusPx / (step * s))) * s;
  const alt = (o.altitudeDeg * Math.PI) / 180;
  const az = (o.azimuthDeg * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt);
  const ly = -Math.cos(az) * Math.cos(alt);
  const lz = Math.sin(alt);
  const i0 = inset, i1 = cols - 1 - inset;
  const shade = [], light = [];
  const rows = field.rows;
  for (let gj = i0; gj <= rows - 1 - inset; gj += s) {
    for (let gi = i0; gi <= i1; gi += s) {
      const fu = ((data[gj * cols + gi + off] - data[gj * cols + gi - off]) / (2 * step * off)) * o.relief;
      const fv = ((data[(gj + off) * cols + gi] - data[(gj - off) * cols + gi]) / (2 * step * off)) * o.relief;
      const len = Math.sqrt(fu * fu + fv * fv + 1);
      let illum = (-fu / len) * lx + (-fv / len) * ly + (1 / len) * lz;
      if (illum < 0) illum = 0;
      if (illum < lz) shade.push((lz - illum) / lz);
      else light.push((illum - lz) / (1 - lz));
    }
  }
  const q = (arr, p) => (arr.length ? arr.sort((a, b) => a - b)[Math.floor(p * (arr.length - 1))] : 0);
  return {
    offPx: off * step,
    shadowShare: +((shade.length / (shade.length + light.length)) * 100).toFixed(1),
    shadeT: [q(shade, 0.5), q(shade, 0.9), q(shade, 0.99)].map((v) => +v.toFixed(2)),
    lightT: [q(light, 0.5), q(light, 0.9), q(light, 0.99)].map((v) => +v.toFixed(2)),
  };
}

for (const gradientRadiusPx of [15, 30, 60]) {
  for (const relief of [120, 260, 450]) {
    const o = { gradientRadiusPx, relief, stride: 2, altitudeDeg: 45, azimuthDeg: 315 };
    const d = distribution(field, o);
    const shade = buildHillshade(field, { ...o, shadowAlpha: 0.16, lightAlpha: 0.08 });
    const png = encodePng(shade.width, shade.height, shade.rgba, 4);
    console.log(JSON.stringify({
      gradientRadiusPx, relief, ...d,
      pngKB: +(png.length / 1024).toFixed(1),
      shadowPx: shade.stats.shadowPixelPercent, lightPx: shade.stats.lightPixelPercent, flatPx: shade.stats.flatPixelPercent,
    }));
  }
}
