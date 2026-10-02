// 单向光照（山体阴影 / hillshade）。
//
// 量化表：「光照：单一方向（默认左上打光），东南坡稍暗；只做整体明暗，不要局部光斑」。
//
// 做法是标准 Lambert 明暗：由高度场求法线，与一个固定光向量点乘，得到 illum ∈ [0,1]。
// 平地 illum = sin(高度角)，以此为中性值，两侧分别叠黑（背光）与叠白（迎光）。
// 只有一束平行光、没有衰减、没有光斑，符合规格。
//
// 这一层是位图：SVG 里没有「由高度场求法线」的原生手段，且背景底纹只需低频明暗。
// 本模块只算 RGBA，不负责编码 —— 交给调用方注入的 PNG 编码器（Node: zlib；浏览器: CompressionStream），
// 因此这里没有任何宿主 API 依赖。

export const SHADE_DEFAULTS = {
  azimuthDeg: 315,   // 光的来向（罗盘角）：315° = 西北 = 左上
  altitudeDeg: 45,   // 光的高度角
  gradientRadiusPx: 60, // 求坡度的差分半径：只取大尺度地形，避免高频倍频把明暗搞成迷彩
  relief: 260,       // 垂直夸张：把 [0,1] 的高度换算成像素尺度，决定坡度大小
  shadowAlpha: 0.28, // 背光侧最多叠多少黑
  // 迎光侧默认不叠白：规格是「东南坡稍暗」「不要局部光斑」，
  // 提亮会在圆丘上生成成片亮块（实测观感就是光斑），因此默认为 0，需要时再打开。
  lightAlpha: 0.0,
  stride: 2,         // 采样格上每隔几个点取一个明暗像素（3px × 2 = 6px 一格）
  normalize: false,  // true = 输出「归一化明暗」：强度写满，留给风格层决定最终强度
};

/**
 * @returns {{width:number,height:number,rgba:Uint8Array,stats:object,options:object}}
 */
export function buildHillshade(field, options = {}) {
  const o = { ...SHADE_DEFAULTS, ...options };
  const { cols, rows, step, pad, data } = field;

  const inset = Math.round(pad / step);
  const s = Math.max(1, Math.round(o.stride));
  const gridPx = step * s;
  // 差分半径换算成“几个明暗格”，至少 1 格
  const k = Math.max(1, Math.round(o.gradientRadiusPx / gridPx));
  const off = k * s; // 采样格上的偏移量
  const insetNeeded = off;
  if (insetNeeded > inset) {
    throw new Error(`gradientRadiusPx=${o.gradientRadiusPx} 超出外扩区（pad=${pad}px, step=${step}px）`);
  }

  const i0 = inset;
  const i1 = cols - 1 - inset;
  const j0 = inset;
  const j1 = rows - 1 - inset;
  const w = Math.floor((i1 - i0) / s) + 1;
  const h = Math.floor((j1 - j0) / s) + 1;

  const alt = (o.altitudeDeg * Math.PI) / 180;
  const az = (o.azimuthDeg * Math.PI) / 180;
  const cosAlt = Math.cos(alt);
  // 光向量（图像坐标：x 向右、y 向下、z 指向屏幕外）
  const lx = Math.sin(az) * cosAlt;
  const ly = -Math.cos(az) * cosAlt;
  const lz = Math.sin(alt);
  const neutral = lz; // 平地的 N·L
  const spanDown = neutral;         // 背光侧可用范围
  const spanUp = 1 - neutral;       // 迎光侧可用范围

  const rgba = new Uint8Array(w * h * 4);
  const hist = { shadow: 0, light: 0, flat: 0 };
  let maxShadow = 0;
  let maxLight = 0;

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const gi = i0 + i * s;
      const gj = j0 + j * s;
      const xm = data[gj * cols + gi - off];
      const xp = data[gj * cols + gi + off];
      const ym = data[(gj - off) * cols + gi];
      const yp = data[(gj + off) * cols + gi];

      // 大半径中心差分（px），再乘垂直夸张：相当于对坡度做了低通，明暗只跟大尺度地形走
      const fu = ((xp - xm) / (2 * step * off)) * o.relief;
      const fv = ((yp - ym) / (2 * step * off)) * o.relief;

      // 法线 ∝ (-fu, -fv, 1)
      const len = Math.sqrt(fu * fu + fv * fv + 1);
      const nx = -fu / len;
      const ny = -fv / len;
      const nz = 1 / len;

      let illum = nx * lx + ny * ly + nz * lz;
      if (illum < 0) illum = 0;

      const p = (j * w + i) * 4;
      if (illum < neutral) {
        // 背光：把 [0, neutral] 归一化到 [0,1]，再乘最大叠黑量
        const t = (neutral - illum) / spanDown;
        const a = t * (o.normalize ? 1 : o.shadowAlpha);
        rgba[p] = 0; rgba[p + 1] = 0; rgba[p + 2] = 0;
        rgba[p + 3] = Math.round(a * 255);
        if (a > maxShadow) maxShadow = a;
        if (a > 0.01) hist.shadow++; else hist.flat++;
      } else {
        // 迎光：把 [neutral, 1] 归一化到 [0,1]
        const t = spanUp > 0 ? (illum - neutral) / spanUp : 0;
        const a = t * (o.normalize ? 1 : o.lightAlpha);
        rgba[p] = 255; rgba[p + 1] = 255; rgba[p + 2] = 255;
        rgba[p + 3] = Math.round(a * 255);
        if (a > maxLight) maxLight = a;
        if (a > 0.01) hist.light++; else hist.flat++;
      }
    }
  }

  const total = w * h;
  return {
    width: w,
    height: h,
    rgba,
    options: o,
    stats: {
      gridSize: `${w}x${h}`,
      pixelsPerShadeSample: step * s,
      normalized: !!o.normalize,
      lightVector: [+lx.toFixed(3), +ly.toFixed(3), +lz.toFixed(3)],
      neutral: +neutral.toFixed(3),
      shadowPixelPercent: +((hist.shadow / total) * 100).toFixed(1),
      lightPixelPercent: +((hist.light / total) * 100).toFixed(1),
      flatPixelPercent: +((hist.flat / total) * 100).toFixed(1),
      maxShadowAlpha: +maxShadow.toFixed(3),
      maxLightAlpha: +maxLight.toFixed(3),
    },
  };
}
