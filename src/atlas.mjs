// 分层等高线方案（Figma/PS 参数表）的矢量实现。
//
// 五层 + 一层叠加材质，逐项对应给定的参数：
//   第1层 主线   1.5px #4A4A4A 35%      每 5 条一条（计曲线）
//   第2层 辅线   0.75px #3A3A3A 20%     填充主线之间的空隙
//   第3层 属性线 0.5px #C4912B 18% 滤色（山体） / #2E5EAA 15% 叠加（水域·低洼），局部出现不铺满
//   第4层 断裂   卡片区域降到 3~5%，边缘外 20px 羽化
//   第5层 标注   0.5px 圆环 + 中心实心点 #D4A833 50%，旁挂等高程数值标签
//   叠加材质     白色噪点 2% 柔光 + 1px 扫描线 每 3px 重复 4% + 径向渐变 正片叠底
//
// 混合模式用 CSS mix-blend-mode（浏览器支持；纯 SVG 渲染器不认），已在 README 里注明。

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

import { buildSvg } from './svg.mjs';
import { catmullRomPath } from './smooth.mjs';

export const ATLAS_DEFAULTS = {
  // 高程刻度：层数 × 步长 = 满量程。49 层 × 20m = 980m，第 5 条正好是 100m 的计曲线。
  intervals: 49,
  elevationStep: 20,

  // 主线 / 辅线的层次：实测峰值亮度 主线 +18、辅线 +5 —— 看起来太"平整"。
  // 线宽 1.5→2.0、不透明度 35%→50%，把层次拉到约 +26 / +5（≈5 倍差距），形成首曲线/计曲线的真实地图逻辑。
  major: { width: 2.0, color: '#4A4A4A', opacity: 0.5, every: 5 },
  minor: { width: 0.75, color: '#3A3A3A', opacity: 0.2 },

  attribute: {
    width: 0.5,
    every: 3,               // 属性线只取每隔几条，保证「局部出现、不铺满」
    // 逐段分类：暖色只给「高且陡」的线段，冷色只给「低/临水」的线段，其余整段不上色。
    warm: { color: '#C4912B', opacity: 0.18, blend: 'screen', fromLevel: 0.5, slopePercentile: 0.72, minRunPoints: 2 },
    cool: { color: '#2E5EAA', opacity: 0.15, blend: 'overlay', toLevel: 0.34, minRunPoints: 2 },
  },

  // 第4层：给定 UI 卡片矩形（视口坐标），卡片下方等高线近乎消失并羽化过渡
  fade: null, // { rects:[{x,y,w,h}], to: 0.04, feather: 20, corner: 12 }

  // 高程标注：原来 7px / 40% 实测峰值只有 L83，投影到大屏基本消失。
  // 提到 8px / 85%，实测峰值约 L150，能在投影上读出"这是个有数值的终端"，同时不改变颜色体系。
  markers: {
    color: '#D4A833', opacity: 0.85, ringWidth: 0.5, dotRadius: 0.9, ringRadius: 3.2,
    count: 4,          // 每屏标注点数
    labelSize: 8, labelOpacity: 0.85, elevationStep: 20,
  },

  overlay: {
    noise: { color: '#FFFFFF', opacity: 0.02, frequency: 0.85, octaves: 2, blend: 'soft-light' },
    scanlines: { color: '#000000', opacity: 0.04, period: 3 },
    // 原参数写的是「中心 #000 0% → 透明 60%」，但那样正片叠底会把**中心**压黑；
    // 而它的目的是「让边缘等高线隐入黑暗」，所以这里按目的实现：中心透明，边缘压暗。
    vignette: { color: '#000000', from: 0.45, maxOpacity: 0.6, blend: 'multiply' },
  },
};

/** 高程 = 层级序号 × 步长（例如 11 × 20 = 220m），用于第 5 层的数值标签。 */
export function elevationAt(level, intervals, step) {
  return Math.round(level * intervals) * step;
}

/**
 * 由已建好的地形结构（等高线几何已在该结构里）生成分层图层 + defs。
 *
 * @param {object} terrain buildTerrain 的结果
 * @param {object} [options] 覆盖 ATLAS_DEFAULTS
 * @returns {{layers:Array, defs:string, stats:object}}
 */
export function buildAtlasLayers(terrain, options = {}) {
  const o = { ...ATLAS_DEFAULTS, ...options };
  const { width, height } = terrain;
  const contours = terrain.layers.filter((l) => l.kind === 'contour');
  if (!contours.length) throw new Error('buildAtlasLayers: terrain 里没有等高线图层');

  const levelsAsc = [...contours.map((l) => l.level)].sort((a, b) => a - b);
  const ordinalOf = new Map(levelsAsc.map((lv, i) => [lv, i + 1]));

  const majorD = [];
  const minorD = [];
  const warmD = [];
  const coolD = [];

  // 第3层要「局部出现」，所以不能整条等高线按高程着色，必须逐段分类后切分。
  const classify = makeAttributeClassifier(terrain.field, o);

  for (const l of contours) {
    const ordinal = ordinalOf.get(l.level);
    const isMajor = ordinal % o.major.every === 0;
    (isMajor ? majorD : minorD).push(l.d);

    if (o.attribute.every > 0 && ordinal % o.attribute.every === 0 && l.paths) {
      for (const piece of splitByAttribute(l.paths, classify, o.attribute)) {
        const d = catmullRomPath(piece.points, piece.closed);
        if (piece.cls === 'warm') warmD.push(d);
        else if (piece.cls === 'cool') coolD.push(d);
      }
    }
  }

  const stats = {
    intervals: o.intervals,
    majorLines: majorD.length,
    minorLines: minorD.length,
    warmSegments: warmD.length,
    coolSegments: coolD.length,
  };

  const fadeMask = o.fade ? buildFadeMask(o.fade, width, height) : null;
  const marks = buildMarkers(terrain, o, levelsAsc);

  const layers = [
    // 第1层 主线
    { d: majorD.join(''), stroke: o.major.color, strokeWidth: o.major.width, strokeOpacity: o.major.opacity, mask: fadeMask ? 'card-fade' : undefined },
    // 第2层 辅线
    { d: minorD.join(''), stroke: o.minor.color, strokeWidth: o.minor.width, strokeOpacity: o.minor.opacity, mask: fadeMask ? 'card-fade' : undefined },
    // 第3层 属性线（混合模式）
    { d: warmD.join(''), stroke: o.attribute.warm.color, strokeWidth: o.attribute.width, strokeOpacity: o.attribute.warm.opacity, style: `mix-blend-mode:${o.attribute.warm.blend}`, mask: fadeMask ? 'card-fade' : undefined },
    { d: coolD.join(''), stroke: o.attribute.cool.color, strokeWidth: o.attribute.width, strokeOpacity: o.attribute.cool.opacity, style: `mix-blend-mode:${o.attribute.cool.blend}`, mask: fadeMask ? 'card-fade' : undefined },
    // 叠加材质：噪点 / 扫描线 / 径向渐变
    { raw: o.overlay.noise ? `<rect width="${width}" height="${height}" fill="url(#atlas-noise)" style="mix-blend-mode:${o.overlay.noise.blend}"/>` : '' },
    { raw: o.overlay.scanlines ? `<rect width="${width}" height="${height}" fill="url(#atlas-scan)" opacity="${o.overlay.scanlines.opacity}"/>` : '' },
    { raw: o.overlay.vignette ? `<rect width="${width}" height="${height}" fill="url(#atlas-vignette)" style="mix-blend-mode:${o.overlay.vignette.blend}"/>` : '' },
    // 第5层 标注点放在**最后**：它是数据标签，不该被暗角压暗。
    // （标注点分散在画面边缘，压在暗角下面会实测从 L150 掉到 L125。）
    { raw: marks.markup },
  ];

  const defs = [fadeMask?.defs, noiseDefs(o.overlay.noise), scanDefs(o.overlay.scanlines), vignetteDefs(o.overlay.vignette)]
    .filter(Boolean)
    .join('\n');

  stats.markers = marks.count;
  return { layers, defs, stats };
}

/**
 * 地形属性分类器：把视口坐标映射到高度场格点，判断该处属于
 *   'warm' 山体区（高于 warm.fromLevel 且坡度在 slopePercentile 分位以上）
 *   'cool' 水域/低洼区（低于 cool.toLevel）
 *   'none' 其余
 *
 * 坡度阈值取**分位数**而不是绝对值，这样换 seed / 换尺寸都不用手调。
 */
export function makeAttributeClassifier(field, o) {
  const { cols, rows, step, x0, y0, data } = field;
  const pad = field.pad ?? 0;
  const warm = o.attribute.warm;
  const cool = o.attribute.cool;

  const gradAt = (i, j) => {
    const gx = (data[j * cols + i + 1] - data[j * cols + i - 1]) / (2 * step);
    const gy = (data[(j + 1) * cols + i] - data[(j - 1) * cols + i]) / (2 * step);
    return Math.hypot(gx, gy);
  };

  // 坡度分位阈值：只在视口范围内取样
  let slopeThreshold = 0;
  if (Number.isFinite(warm.slopePercentile)) {
    const inset = Math.round(pad / step);
    const samples = [];
    for (let j = inset + 1; j < rows - 1 - inset; j += 2) {
      for (let i = inset + 1; i < cols - 1 - inset; i += 2) samples.push(gradAt(i, j));
    }
    samples.sort((a, b) => a - b);
    slopeThreshold = samples[Math.floor(warm.slopePercentile * (samples.length - 1))] ?? 0;
  }

  return (x, y) => {
    const i = Math.round((x + pad) / step);
    const j = Math.round((y + pad) / step);
    if (i < 1 || j < 1 || i >= cols - 1 || j >= rows - 1) return 'none';
    const h = data[j * cols + i];
    if (h >= warm.fromLevel && gradAt(i, j) >= slopeThreshold) return 'warm';
    if (h <= cool.toLevel) return 'cool';
    return 'none';
  };
}

/**
 * 按属性把一条等高线切成若干同属性的段。
 * 闭合环要处理首尾相接：若首尾同属性则合并成一段。
 * 太短的段直接丢掉，避免出现碎屑状的颜色点。
 */
export function splitByAttribute(paths, classify, attribute) {
  const out = [];
  const minPts = Math.max(2, attribute.minRunPoints ?? 2);

  for (const path of paths) {
    const pts = path.points;
    if (pts.length < 2) continue;
    const cls = pts.map((p) => classify(p.x, p.y));

    if (path.closed) {
      // 找到属性变化处作为起点，避免环被切断在中间
      let start = cls.findIndex((c, k) => c !== cls[(k - 1 + cls.length) % cls.length]);
      if (start < 0) start = 0; // 全环同属性
      const runs = [];
      let cur = null;
      for (let k = 0; k < pts.length; k++) {
        const idx = (start + k) % pts.length;
        const c = cls[idx];
        if (!cur || cur.cls !== c) {
          cur = { cls: c, points: [pts[idx]] };
          runs.push(cur);
        } else {
          cur.points.push(pts[idx]);
        }
      }
      // 环闭合：首尾同属性则合并
      if (runs.length > 1 && runs[0].cls === runs[runs.length - 1].cls) {
        runs[0].points = [...runs.pop().points, ...runs[0].points];
      }
      for (const r of runs) {
        if (r.cls !== 'none' && r.points.length >= minPts) out.push({ cls: r.cls, points: r.points, closed: true });
      }
      continue;
    }

    let cur = null;
    const runs = [];
    for (let k = 0; k < pts.length; k++) {
      const c = cls[k];
      if (!cur || cur.cls !== c) {
        cur = { cls: c, points: [pts[k]] };
        runs.push(cur);
      } else {
        cur.points.push(pts[k]);
      }
    }
    for (const r of runs) {
      if (r.cls !== 'none' && r.points.length >= minPts) out.push({ cls: r.cls, points: r.points, closed: false });
    }
  }
  return out;
}

/** 第4层：卡片矩形内把线压到近乎消失，边缘 feather px 内渐变回正常。 */function buildFadeMask(fade, width, height) {
  const { rects, to = 0.05, feather = 20, corner = 12 } = fade;
  const blobs = rects
    .map(
      (r) =>
        `      <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${corner}" fill="#000" filter="url(#card-blur)"/>`,
    )
    .join('\n');
  // 蒙版：白 = 线正常显示；卡片处画黑 = 线被抹掉；靠高斯模糊做羽化
  const defs = `    <filter id="card-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${feather / 2}"/></filter>
    <mask id="card-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>
      <g opacity="${1 - to}">
${blobs}
      </g>
    </mask>`;
  return { defs };
}

/**
 * 第5层：在计曲线（主线）的端点与转折处放标注点，旁边挂等高程数值。
 * 选点规则：先取所有主线的端点，再取转折最急的顶点；按空间分散挑 count 个。
 */
function buildMarkers(terrain, o, levelsAsc) {
  const m = o.markers;
  if (!m || m.count <= 0) return { markup: '', count: 0 };

  const ordinalOf = new Map(levelsAsc.map((lv, i) => [lv, i + 1]));
  const candidates = [];

  for (const l of terrain.layers) {
    if (l.kind !== 'contour') continue;
    const ordinal = ordinalOf.get(l.level);
    if (ordinal % o.major.every !== 0) continue;
    const elevation = elevationAt(l.level, o.intervals, o.elevationStep);
    // 用简化后的控制点不方便，这里直接用几何包围盒定位几个点即可
    const seg = parsePathPoints(l.d);
    if (seg.length < 2) continue;
    candidates.push({ x: seg[0].x, y: seg[0].y, elevation });
    candidates.push({ x: seg[seg.length - 1].x, y: seg[seg.length - 1].y, elevation });
    // 转折：取路径中点附近曲率最大的一处（这里用与首尾连线距离最大的点近似）
    let best = null;
    let bestD = -1;
    const a = seg[0];
    const b = seg[seg.length - 1];
    for (const p of seg) {
      const d = pointLineDistance(p, a, b);
      if (d > bestD) { bestD = d; best = p; }
    }
    if (best && bestD > 12) candidates.push({ x: best.x, y: best.y, elevation });
  }

  // 空间分散：贪心取彼此最远的 count 个
  const picked = [];
  const pool = candidates.filter((c) => c.x > 8 && c.y > 8 && c.x < terrain.width - 8 && c.y < terrain.height - 8);
  while (picked.length < m.count && pool.length) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      let nearest = Infinity;
      for (const p of picked) nearest = Math.min(nearest, Math.hypot(c.x - p.x, c.y - p.y));
      const score = picked.length === 0 ? c.y * 0.01 + 1 : nearest;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    const chosen = pool.splice(bestIdx, 1)[0];
    if (picked.length && bestScore < 90) break; // 太挤就不再放
    picked.push(chosen);
  }

  const markup = picked
    .map((p) => {
      const x = p.x.toFixed(1);
      const y = p.y.toFixed(1);
      const label = String(p.elevation);
      return [
        `    <g fill="none" stroke="${m.color}" stroke-width="${m.ringWidth}" stroke-opacity="${m.opacity}">`,
        `      <circle cx="${x}" cy="${y}" r="${m.ringRadius}"/>`,
        `    </g>`,
        `    <circle cx="${x}" cy="${y}" r="${m.dotRadius}" fill="${m.color}" fill-opacity="${m.opacity}"/>`,
        `    <text x="${(p.x + m.ringRadius + 3).toFixed(1)}" y="${(p.y + 2.6).toFixed(1)}" font-family="${FONT}" font-size="${m.labelSize}" fill="${m.color}" fill-opacity="${m.labelOpacity}" stroke="none">${label}</text>`,
      ].join('\n');
    })
    .join('\n');

  return { markup, count: picked.length };
}

/** 从贝塞尔 path 里粗略抽点（只用于选标注位置，不需要精确）。 */
function parsePathPoints(d) {
  const pts = [];
  const re = /[MC](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(d))) pts.push({ x: Number(m[1]), y: Number(m[2]) });
  return pts;
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function noiseDefs(n) {
  if (!n) return '';
  return `    <filter id="atlas-noise" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${n.frequency}" numOctaves="${n.octaves}" stitchTiles="stitch" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${n.opacity} 0"/>
    </filter>`;
}

function scanDefs(s) {
  if (!s) return '';
  return `    <pattern id="atlas-scan" width="1" height="${s.period}" patternUnits="userSpaceOnUse">
      <rect x="0" y="0" width="1" height="1" fill="${s.color}"/>
    </pattern>`;
}

function vignetteDefs(v) {
  if (!v) return '';
  const from = v.from ?? 0.45;
  const max = v.maxOpacity ?? 0.6;
  return `    <radialGradient id="atlas-vignette" cx="50%" cy="50%" r="75%">
      <stop offset="0" stop-color="${v.color}" stop-opacity="0"/>
      <stop offset="${from}" stop-color="${v.color}" stop-opacity="0"/>
      <stop offset="1" stop-color="${v.color}" stop-opacity="${max}"/>
    </radialGradient>`;
}

/**
 * 出图：分层方案没有光照位图，所以整条路径是同步的，不需要 PNG 编码器。
 * @returns {{svg:string, stats:object, options:object}}
 */
export function renderAtlas(terrain, options = {}) {
  const o = { ...ATLAS_DEFAULTS, ...options };
  const { layers, defs, stats } = buildAtlasLayers(terrain, options);
  const svg = buildSvg({
    width: terrain.width,
    height: terrain.height,
    background: options.ground ?? terrain.background ?? '#14171a',
    defs,
    layers,
    meta: { generator: 'hypsa-isopleth', style: 'atlas', seed: terrain.meta?.seed ?? '' },
  });
  return { svg, stats, options: o };
}
