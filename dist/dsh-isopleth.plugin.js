/*!
 * dsh-isopleth plugin — 程序化地形底纹（自包含单文件，无依赖）
 * 由 tools/build-plugin.mjs 从 plugin/entry.mjs 生成，请勿手改。
 * 用法：
 *   <script src="dsh-isopleth.plugin.js"></script>
 *   const plugin = DSH_ISOPLETH.createIsoplethPlugin({ seed: 'isopleth-01' });
 *   await plugin.apply(document.querySelector('#stage'));
 */
(function (global) {
  'use strict';
// ---- src/png.mjs ----
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

function crc32(bytes) {
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
function pngRawScanlines(width, height, pixels, channels) {
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
function pngBytes(width, height, pixels, channels, deflate) {
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
function bytesToBase64(bytes) {
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

// ---- src/noise.mjs ----
// Self-written 2D value noise + fBm. No third-party noise code.
// Deterministic: identical (x, y, seedInt) always yields the identical value.

/** FNV-1a over the seed's string form -> 32-bit unsigned int. */
function hashSeed(seed) {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer lattice hash -> [0, 1). */
function hash2i(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Quintic fade, C2-continuous: keeps contours free of lattice creases. */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bilinear-smoothstep value noise in [0, 1). */
function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const ux = fade(x - x0);
  const uy = fade(y - y0);
  const a = hash2i(x0, y0, seed);
  const b = hash2i(x0 + 1, y0, seed);
  const c = hash2i(x0, y0 + 1, seed);
  const d = hash2i(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

/**
 * Fractional Brownian motion: octaves of value noise, amplitude-normalised to ~[0,1].
 * `seedInt` is a 32-bit int; each octave gets its own lattice phase.
 */
function fbm(x, y, seedInt, { octaves = 6, gain = 0.5, lacunarity = 2 } = {}) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2D(x * freq, y * freq, (seedInt + Math.imul(o + 1, 0x9e3779b1)) | 0);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// ---- src/field.mjs ----
// Height field sampled on a fixed world-space lattice.
//
// World space is independent of the viewport: 1 world unit == 1 CSS px, origin at the
// viewport centre. Feature size is therefore constant in px, so a wide viewport shows
// *more* terrain instead of stretched terrain. No tiling, no repetition, no seams.



const FIELD_DEFAULTS = {
  pad: 64,             // px sampled beyond the viewport, so culling never reveals a gap
  step: 3,             // px between lattice samples
  octaves: 6,          // fBm octave count (spec: 5~7)
  gain: 0.42,          // amplitude falloff. < 0.5 damps the high octaves, whose flat
                       // slope spectrum is what makes isolines look jittery
  lacunarity: 2,
  baseWavelength: 560, // px of the first octave (calibrated: see NOTES.md)
  contrast: 1.5,       // linear gain around 0.5 before clamping
  framing: 'auto',     // 'auto' = pick the window with the widest relief; 'origin' = centred
  // 可选地形塑形（实验）。默认关闭 = 纯 fBm，输出与不带该参数时逐字节一致。
  //   warp:    域扭曲，让山脊连成脉络而不是各向同性的圆丘
  //   terrace: 台地化，把平缓起伏压成「平顶 + 陡崖」，等高线自然在崖壁上聚拢
  shaping: null,
};

/**
 * Deterministic camera: choose where the (infinite) map is framed.
 *
 * Feature size stays fixed in px, so a small canvas would otherwise be a single flat
 * patch with no relief. Instead we slide the sampling window over a coarse lattice and
 * keep the window with the widest height span, preferring windows closest to the origin
 * among the near-best ones. Pure function of (seed, width, height, field params):
 * the same input always frames the same ground.
 */
function pickCamera(p) {
  const { width, height, pad, coarseStep = 80 } = p;
  const radius = Math.max(2400, Math.round(Math.max(width, height) * 1.1));
  const n = Math.floor((radius * 2) / coarseStep) + 1;

  const grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      grid[j * n + i] = samplePoint(p, -radius + i * coarseStep, -radius + j * coarseStep);
    }
  }

  const winW = Math.min(n, Math.ceil((width + pad * 2) / coarseStep));
  const winH = Math.min(n, Math.ceil((height + pad * 2) / coarseStep));

  let bestSpan = -1;
  const candidates = [];
  for (let j = 0; j + winH <= n; j++) {
    for (let i = 0; i + winW <= n; i++) {
      let min = Infinity;
      let max = -Infinity;
      for (let b = j; b < j + winH; b++) {
        const row = b * n;
        for (let a = i; a < i + winW; a++) {
          const v = grid[row + a];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const span = max - min;
      if (span > bestSpan) bestSpan = span;
      candidates.push({ span, i, j });
    }
  }

  // Prefer a near-best window that sits closest to the origin.
  const threshold = bestSpan * 0.97;
  let best = null;
  for (const c of candidates) {
    if (c.span < threshold) continue;
    const cx = -radius + (c.i + winW / 2) * coarseStep;
    const cy = -radius + (c.j + winH / 2) * coarseStep;
    const dist = Math.hypot(cx, cy);
    if (!best || dist < best.dist) best = { dist, cx, cy, span: c.span };
  }
  return { cx: best ? best.cx : 0, cy: best ? best.cy : 0, span: best ? best.span : 0, radius };
}

function samplePoint(p, wx, wy) {
  const raw = fbm(wx / p.baseWavelength, wy / p.baseWavelength, p.seedInt, {
    octaves: p.octaves,
    gain: p.gain,
    lacunarity: p.lacunarity,
  });
  let h = 0.5 + (raw - 0.5) * p.contrast;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  return p.shaping ? applyShaping(h, wx, wy, p.shaping, p.seedInt) : h;
}

/** 台地化：把 [0,1] 压成 N 级平顶，级间保留一段过渡作为崖壁。 */
function terrace(h, steps, softness) {
  const x = h * steps;
  const i = Math.floor(x);
  const f = x - i;
  const s = Math.max(1e-4, softness);
  let t = (f - (1 - s) / 2) / s;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const eased = t * t * (3 - 2 * t);
  return (i + eased) / steps;
}

/**
 * 塑形：先域扭曲（让山脊连成脉络），再台地化（平顶 + 陡崖）。
 * softness 越小崖壁越陡；steps 建议与等高线层级数同量级，让线在崖壁上成束。
 */
function applyShaping(h, wx, wy, shaping, seedInt) {
  const { warp, terrace: terr } = { ...shaping };
  let v = h;
  if (warp) {
    const amp = warp.amp ?? 160;
    const wl = warp.wavelength ?? 1400;
    const a = Number.isFinite(warp.seedA) ? warp.seedA : 0x51ed270b;
    const b = Number.isFinite(warp.seedB) ? warp.seedB : 0x1b873593;
    // 用同一个高度场的邻域做位移，不引入额外噪声源
    const dx = fbm(wx / wl + 11.3, wy / wl + 3.7, (seedInt ^ a) | 0, { octaves: 3 }) - 0.5;
    const dy = fbm(wx / wl + 4.1, wy / wl + 19.9, (seedInt ^ b) | 0, { octaves: 3 }) - 0.5;
    v = fbm((wx + dx * amp * 2) / (warp.baseWavelength ?? 560), (wy + dy * amp * 2) / (warp.baseWavelength ?? 560), seedInt, {
      octaves: warp.octaves ?? 6,
      gain: warp.gain ?? 0.42,
      lacunarity: 2,
    });
    v = 0.5 + (v - 0.5) * (warp.contrast ?? 1.5);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  if (terr) v = terrace(v, terr.steps ?? 9, terr.softness ?? 0.22);
  return v;
}

/**
 * @returns {{cols:number, rows:number, step:number, x0:number, y0:number,
 *            data:Float32Array, min:number, max:number, width:number, height:number,
 *            pad:number, camera:object, params:object}}
 */
function buildField(opts) {
  const p = { ...FIELD_DEFAULTS, ...opts };
  const { width, height, pad, step, octaves, gain, lacunarity, baseWavelength, contrast } = p;
  const seedInt = hashSeed(p.seed);
  const params = { ...p, seedInt };

  const camera = p.framing === 'origin' ? { cx: 0, cy: 0, span: null } : pickCamera(params);
  const x0 = camera.cx - width / 2 - pad;
  const y0 = camera.cy - height / 2 - pad;

  const cols = Math.ceil((width + pad * 2) / step) + 1;
  const rows = Math.ceil((height + pad * 2) / step) + 1;

  const data = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;

  const shaping = p.shaping;

  for (let j = 0; j < rows; j++) {
    const wy = y0 + j * step;
    const ny = wy / baseWavelength;
    const row = j * cols;
    for (let i = 0; i < cols; i++) {
      const wx = x0 + i * step;
      const nx = wx / baseWavelength;
      const raw = fbm(nx, ny, seedInt, { octaves, gain, lacunarity });
      let h = 0.5 + (raw - 0.5) * contrast;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      if (shaping) h = applyShaping(h, wx, wy, shaping, seedInt);
      data[row + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  return { cols, rows, step, x0, y0, data, min, max, width, height, pad, camera, params };
}

/** Bilinear read in world coordinates (used for reporting only). */
function sampleField(field, wx, wy) {
  const fx = (wx - field.x0) / field.step;
  const fy = (wy - field.y0) / field.step;
  const i = Math.max(0, Math.min(field.cols - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(field.rows - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const ty = Math.max(0, Math.min(1, fy - j));
  const d = field.data;
  const r0 = j * field.cols + i;
  const r1 = r0 + field.cols;
  const a = d[r0] + (d[r0 + 1] - d[r0]) * tx;
  const b = d[r1] + (d[r1 + 1] - d[r1]) * tx;
  return a + (b - a) * ty;
}

// ---- src/marching.mjs ----
// Marching squares over the lattice.
//
// Every crossing lives on a lattice edge, so a shared edge is identified by an exact
// integer id: neighbouring cells join with no epsilon matching and no orphan vertices.
// Ambiguous cases (5 / 10) are resolved by the centre value, which keeps the two
// resulting segments from crossing each other.
//
// Two products share the same graph tracer:
//   extractIsolines      -- one level value -> contour polylines / rings
//   extractBandPolygons  -- a level *range* -> closed polygons of that band region
// The band polygons reuse the same linearly interpolated crossing points, so a band
// edge lies exactly on the contour line of the same level.

const H_EDGE = 0; // between (i, j) and (i+1, j)
const V_EDGE = 1; // between (i, j) and (i, j+1)

const SEGMENT_TABLE = {
  1: [['L', 'T']],
  2: [['T', 'R']],
  3: [['L', 'R']],
  4: [['R', 'B']],
  6: [['T', 'B']],
  7: [['L', 'B']],
  8: [['L', 'B']],
  9: [['T', 'B']],
  11: [['R', 'B']],
  12: [['L', 'R']],
  13: [['T', 'R']],
  14: [['L', 'T']],
};

function makeGraph() {
  const px = new Map();
  const py = new Map();
  const segments = [];
  const adjacency = new Map();

  return {
    point(id, x, y) {
      if (!px.has(id)) {
        px.set(id, x);
        py.set(id, y);
      }
      return id;
    },
    x: (id) => px.get(id),
    y: (id) => py.get(id),
    segmentCount: () => segments.length,
    link(a, b) {
      if (a === b) return;
      const seg = { a, b, used: false };
      segments.push(seg);
      let la = adjacency.get(a);
      if (!la) adjacency.set(a, (la = []));
      la.push(seg);
      let lb = adjacency.get(b);
      if (!lb) adjacency.set(b, (lb = []));
      lb.push(seg);
    },
    /** Walk the segment graph into maximal chains. */
    chains() {
      const out = [];
      const walkFrom = (startId, startSeg) => {
        const ids = [startId];
        let cur = startId;
        let seg = startSeg;
        while (seg) {
          seg.used = true;
          cur = seg.a === cur ? seg.b : seg.a;
          ids.push(cur);
          if (cur === startId) break;
          const list = adjacency.get(cur);
          if (!list || list.length === 1) break;
          seg = null;
          for (let k = 0; k < list.length; k++) {
            if (!list[k].used) { seg = list[k]; break; }
          }
        }
        return { ids, closed: ids[ids.length - 1] === startId && ids.length > 3 };
      };

      for (const [id, list] of adjacency) {
        if (list.length === 1 && !list[0].used) out.push(walkFrom(id, list[0]));
      }
      for (const seg of segments) {
        if (seg.used) continue;
        const startId = seg.a;
        const ids = [startId];
        let cur = startId;
        let s = seg;
        while (s) {
          s.used = true;
          cur = s.a === cur ? s.b : s.a;
          ids.push(cur);
          if (cur === startId) break;
          const list = adjacency.get(cur);
          s = null;
          if (list) for (let k = 0; k < list.length; k++) if (!list[k].used) { s = list[k]; break; }
        }
        out.push({ ids, closed: ids[ids.length - 1] === startId && ids.length > 3 });
      }
      return out;
    },
  };
}

/** Turn chains into viewport-space points with length / extent measurements. */
function materialize(graph, chains) {
  const paths = [];
  for (const chain of chains) {
    let ids = chain.ids;
    const closed = chain.closed;
    if (closed && ids.length > 1 && ids[ids.length - 1] === ids[0]) ids = ids.slice(0, -1);
    const points = new Array(ids.length);
    for (let k = 0; k < ids.length; k++) points[k] = { x: graph.x(ids[k]), y: graph.y(ids[k]) };

    let length = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (k < points.length - 1) length += Math.hypot(b.x - a.x, b.y - a.y);
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
    }
    if (closed && points.length > 1) {
      const a = points[points.length - 1];
      length += Math.hypot(points[0].x - a.x, points[0].y - a.y);
    }
    paths.push({ points, closed, length, extent: Math.max(maxX - minX, maxY - minY), drop: null });
  }
  return paths;
}

function applyFilters(paths, { minPolylineLength, minRingExtent }) {
  const stats = {
    chains: paths.length,
    kept: 0,
    droppedShortOpen: 0,
    droppedSmallRing: 0,
    rings: 0,
    open: 0,
    totalLength: 0,
    vertices: 0,
  };
  for (const p of paths) {
    if (p.closed && p.extent < minRingExtent) {
      p.drop = 'small-ring';
      stats.droppedSmallRing++;
    } else if (!p.closed && p.length < minPolylineLength) {
      p.drop = 'short-open';
      stats.droppedShortOpen++;
    } else {
      stats.kept++;
      stats.totalLength += p.length;
      stats.vertices += p.points.length;
      if (p.closed) stats.rings++;
      else stats.open++;
    }
  }
  return stats;
}

/**
 * Contour lines at one level.
 * @returns {{paths:Array, allPaths:Array, stats:object}}
 */
function extractIsolines(field, level, opts = {}) {
  const minPolylineLength = opts.minPolylineLength ?? 40;
  const minRingExtent = opts.minRingExtent ?? 21;

  const { cols, rows, step, x0, y0, data } = field;
  // 视口原点 = 外扩框原点 + pad。必须减视口原点而不是外扩框原点，否则整张图会偏移一个 pad：
  // 色带与等高线一起偏所以肉眼看不出，但内嵌的明暗位图是按视口放的，两者会错位。
  const vx0 = x0 + (field.pad ?? 0);
  const vy0 = y0 + (field.pad ?? 0);
  const toViewX = (wx) => wx - vx0;
  const toViewY = (wy) => wy - vy0;

  const graph = makeGraph();
  const edgePoint = (id, i0, j0, v0, i1, j1, v1) => {
    if (graph.x(id) !== undefined) return id;
    const dv = v1 - v0;
    const t = dv === 0 ? 0.5 : (level - v0) / dv;
    return graph.point(id, toViewX(x0 + (i0 + (i1 - i0) * t) * step), toViewY(y0 + (j0 + (j1 - j0) * t) * step));
  };

  for (let j = 0; j < rows - 1; j++) {
    const r0 = j * cols;
    const r1 = r0 + cols;
    for (let i = 0; i < cols - 1; i++) {
      const v0 = data[r0 + i];
      const v1 = data[r0 + i + 1];
      const v2 = data[r1 + i + 1];
      const v3 = data[r1 + i];

      let code = 0;
      if (v0 > level) code |= 1;
      if (v1 > level) code |= 2;
      if (v2 > level) code |= 4;
      if (v3 > level) code |= 8;
      if (code === 0 || code === 15) continue;

      const hTop = (j * cols + i) * 2 + H_EDGE;
      const hBot = ((j + 1) * cols + i) * 2 + H_EDGE;
      const vLeft = (j * cols + i) * 2 + V_EDGE;
      const vRight = (j * cols + i + 1) * 2 + V_EDGE;

      const E = {
        T: () => edgePoint(hTop, i, j, v0, i + 1, j, v1),
        R: () => edgePoint(vRight, i + 1, j, v1, i + 1, j + 1, v2),
        B: () => edgePoint(hBot, i, j + 1, v3, i + 1, j + 1, v2),
        L: () => edgePoint(vLeft, i, j, v0, i, j + 1, v3),
      };

      if (code === 5 || code === 10) {
        const centreInside = (v0 + v1 + v2 + v3) * 0.25 > level;
        if (code === 5) {
          if (centreInside) {
            graph.link(E.T(), E.R());
            graph.link(E.L(), E.B());
          } else {
            graph.link(E.L(), E.T());
            graph.link(E.R(), E.B());
          }
        } else if (centreInside) {
          graph.link(E.L(), E.T());
          graph.link(E.R(), E.B());
        } else {
          graph.link(E.T(), E.R());
          graph.link(E.L(), E.B());
        }
        continue;
      }

      const pairs = SEGMENT_TABLE[code];
      for (let k = 0; k < pairs.length; k++) graph.link(E[pairs[k][0]](), E[pairs[k][1]]());
    }
  }

  const allPaths = materialize(graph, graph.chains());
  const stats = applyFilters(allPaths, { minPolylineLength, minRingExtent });
  stats.level = level;
  stats.segments = graph.segmentCount();
  return { paths: allPaths.filter((p) => !p.drop), allPaths, stats };
}

/**
 * Closed polygons of the region `low < h < high`, in viewport space.
 *
 * Crossing positions come from the height field itself, so a band edge is the very
 * same polyline the contour of that level draws -- fill and line cannot drift apart.
 * `low: -Infinity` / `high: Infinity` express the open-ended bottom / top bands.
 *
 * The outermost lattice ring is forced to a value below `low`, which keeps every band
 * enclosed by the padded frame (61 px outside the viewport, clipped away) and therefore
 * closed -- no boundary stitching, no straight chord cutting across visible terrain.
 */
function extractBandPolygons(field, low, high, opts = {}) {
  const minRingExtent = opts.minRingExtent ?? 2;
  const { cols, rows, step, x0, y0, data } = field;
  const vx0 = x0 + (field.pad ?? 0);
  const vy0 = y0 + (field.pad ?? 0);
  const toViewX = (wx) => wx - vx0;
  const toViewY = (wy) => wy - vy0;

  const inside = (v) => v > low && v < high;
  // 哨兵值必须落在区域「外面」：单侧开口时按开口方向取，双侧有限时取低侧再往下压一档。
  let SENTINEL;
  if (!Number.isFinite(low)) SENTINEL = high + 1;        // 区域是 h < high
  else if (!Number.isFinite(high)) SENTINEL = low - 1;   // 区域是 h > low
  else SENTINEL = low - (high - low);

  const valueAt = (i, j) => {
    if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) return SENTINEL;
    return data[j * cols + i];
  };

  const graph = makeGraph();
  const edgePoint = (id, i0, j0, v0, i1, j1, v1) => {
    if (graph.x(id) !== undefined) return id;
    // The mask flips across this edge at whichever boundary the corner values straddle.
    const level = (v0 > low) !== (v1 > low) ? low : high;
    const dv = v1 - v0;
    const t = dv === 0 ? 0.5 : (level - v0) / dv;
    return graph.point(id, toViewX(x0 + (i0 + (i1 - i0) * t) * step), toViewY(y0 + (j0 + (j1 - j0) * t) * step));
  };

  for (let j = 0; j < rows - 1; j++) {
    const r0 = j * cols;
    const r1 = r0 + cols;
    for (let i = 0; i < cols - 1; i++) {
      const v0 = valueAt(i, j);
      const v1 = valueAt(i + 1, j);
      const v2 = valueAt(i + 1, j + 1);
      const v3 = valueAt(i, j + 1);

      let code = 0;
      if (inside(v0)) code |= 1;
      if (inside(v1)) code |= 2;
      if (inside(v2)) code |= 4;
      if (inside(v3)) code |= 8;
      if (code === 0 || code === 15) continue;

      const hTop = (j * cols + i) * 2 + H_EDGE;
      const hBot = ((j + 1) * cols + i) * 2 + H_EDGE;
      const vLeft = (j * cols + i) * 2 + V_EDGE;
      const vRight = (j * cols + i + 1) * 2 + V_EDGE;

      const E = {
        T: () => edgePoint(hTop, i, j, v0, i + 1, j, v1),
        R: () => edgePoint(vRight, i + 1, j, v1, i + 1, j + 1, v2),
        B: () => edgePoint(hBot, i, j + 1, v3, i + 1, j + 1, v2),
        L: () => edgePoint(vLeft, i, j, v0, i, j + 1, v3),
      };

      if (code === 5 || code === 10) {
        // For a *region* mask the centre decider is not meaningful (the centre of the
        // cell is not sampled); the corners being inside is what matters here.
        const centreInside = inside((v0 + v1 + v2 + v3) * 0.25);
        if (code === 5) {
          if (centreInside) {
            graph.link(E.T(), E.R());
            graph.link(E.L(), E.B());
          } else {
            graph.link(E.L(), E.T());
            graph.link(E.R(), E.B());
          }
        } else if (centreInside) {
          graph.link(E.L(), E.T());
          graph.link(E.R(), E.B());
        } else {
          graph.link(E.T(), E.R());
          graph.link(E.L(), E.B());
        }
        continue;
      }

      const pairs = SEGMENT_TABLE[code];
      for (let k = 0; k < pairs.length; k++) graph.link(E[pairs[k][0]](), E[pairs[k][1]]());
    }
  }

  const allPaths = materialize(graph, graph.chains());
  const stats = applyFilters(allPaths, { minPolylineLength: 0, minRingExtent });
  stats.segments = graph.segmentCount();
  return { paths: allPaths.filter((p) => !p.drop), allPaths, stats };
}

// ---- src/simplify.mjs ----
// Douglas-Peucker simplification. Removes marching-squares lattice stepping before
// smoothing, which both shrinks the path data and removes grid-quantised wobble.

function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const tol2 = tolerance * tolerance;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    const ax = points[first].x;
    const ay = points[first].y;
    const bx = points[last].x;
    const by = points[last].y;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;

    let worst = -1;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const px = points[i].x - ax;
      const py = points[i].y - ay;
      let d2;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        let t = (px * dx + py * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - dx * t;
        const ey = py - dy * t;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > worst) { worst = d2; worstIndex = i; }
    }

    if (worst > tol2) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// ---- src/smooth.mjs ----
// Catmull-Rom -> cubic Bezier conversion.

const f = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Build an SVG path `d` from a polyline, smoothed with a centripetal-free uniform
 * Catmull-Rom spline (tangent = (P[i+1] - P[i-1]) / 6).
 */
function catmullRomPath(points, closed) {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${f(points[0].x)} ${f(points[0].y)}`;

  const at = (i) => {
    if (closed) return points[((i % n) + n) % n];
    return points[Math.max(0, Math.min(n - 1, i))];
  };

  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  if (closed) d += 'Z';
  return d;
}

// ---- src/bands.mjs ----
// 分级色带（hypsometric bands）。
//
// 量化表：「色带填充 5~7 级，每级比下一级亮 3%~5%（低透明度白叠加）」。
// 算法规格：「按层级填充闭合环（低层级在下、高层级在上），形成分级色带；等高线画在填充之上」。
//
// 两处层数不一致（等高线 9 条 / 色带 5~7 级）的调和方式：**色带边界必须是等高线层级的一个子集**，
// 这样每条色带边界上正好压着一条等高线，色带接缝被线条盖住，填充边缘与线绝不漂移。





const BAND_DEFAULTS = {
  bandCount: 5,          // 量化表 5~7 级
  lightenStep: 0.05,     // 每级白叠加 3%~5%，取带上沿 5%（细淡反馈）
  dpTolerance: 0.8,      // 比等高线更小的容差，避免填充边缘离线
  // 必须与等高线的 minRingExtent 一致：等高线会丢掉的小环，色带也必须丢，
  // 否则会出现“有色带边界但没有等高线”的孤块（填充与线条不一致）。
  minRingExtent: 21,
  fillColor: '#ffffff',
};

/**
 * 从等高线层级里挑出 bandCount-1 条色带边界，尽量均匀。
 * n=9、bandCount=5 时落在 0.2 / 0.4 / 0.6 / 0.8。
 */
function bandBoundaryLevels(contourLevels, bandCount) {
  const n = contourLevels.length;
  const out = [];
  for (let i = 1; i < bandCount; i++) {
    const idx = Math.round((i * (n + 1)) / bandCount) - 1;
    out.push(contourLevels[Math.max(0, Math.min(n - 1, idx))]);
  }
  return [...new Set(out)];
}

/**
 * @returns {{bands:Array, bounds:number[], stats:object}}
 */
function buildBandLayers(field, config = {}) {
  const c = { ...BAND_DEFAULTS, ...config };
  const bounds = bandBoundaryLevels(c.contourLevels, c.bandCount);
  const edges = [-Infinity, ...bounds, Infinity];

  const bands = [];
  const stats = { bands: 0, rings: 0, vertices: 0, overlaySteps: [] };

  for (let k = 0; k < edges.length - 1; k++) {
    const low = edges[k];
    const high = edges[k + 1];
    const { paths, stats: s } = extractBandPolygons(field, low, high, { minRingExtent: c.minRingExtent });

    let d = '';
    for (const p of paths) {
      const reduced = simplify(p.points, c.dpTolerance);
      stats.vertices += reduced.length;
      d += catmullRomPath(reduced, true);
    }

    const alpha = +(k * c.lightenStep).toFixed(4);
    stats.rings += s.kept;
    stats.bands++;
    stats.overlaySteps.push(alpha);

    bands.push({
      index: k,
      low,
      high,
      d,
      rings: s.kept,
      length: s.totalLength,
      alpha,
      fill: c.fillColor,
    });
  }

  return { bands, bounds, stats };
}

// ---- src/hillshade.mjs ----
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

const SHADE_DEFAULTS = {
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
function buildHillshade(field, options = {}) {
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

// ---- src/tokens.mjs ----
// 色彩与线宽令牌 —— 逐项对应第 2 节视觉规格量化表。
// 表里未出现的视觉元素（光晕、渐变、噪点）不在这里，也不会被渲染。

const TOKENS = {
  // 底色：近黑但偏冷，不要纯黑
  ground: '#14171a',

  // 等高线：冷灰绿；不透明度 8%~14%（取带上沿 14%，实测 1x 落带、2x 略高于带顶，
  // 交叉处会因 alpha 合成再高一点，这是描边叠加的正常结果）
  contour: '#8ea79a',
  contourOpacity: 0.14,
  indexContour: '#8ea79a',
  indexContourOpacity: 0.14,

  // 水面（Step 4 用；低于 0.3 高度处填充）
  water: '#2b3a3d',

  // 主题「当前/选中」色：只用于状态，不用于地形
  highlight: '#fff500',
};

const STROKE = {
  // 量化表建议 0.7px；0.7px 在 1x 屏单行覆盖率约 0.7，实测偏“细淡”，经确认提到 1.0px。
  contour: 1.0,      // 细线
  indexContour: 1.4, // 索引线（每 5 条一条）
};

/** 等值线间距的验收带（屏幕上 px，按 1440 宽计） */
const SPACING_BAND = { min: 40, max: 90, tooDense: 30, tooSparse: 150 };

// ---- src/water.mjs ----
// 水面层。
//
// 量化表：「水面（可选）`#2b3a3d`，低于 0.3 高度处填充」。
// 规格说明里也写着「没有也能用，有则明显更像地图」。
//
// 几何与色带同一套：把 `h < 0.3` 当做一个区域掩膜跑 marching squares，
// 于是水岸线与 0.3 那条等高线是同一批顶点，不会出现「岸线旁边还飘着一条线」的错位。
// 小环阈值与等高线一致（否则会出现没有对应等高线的小水塘）。
//
// 图层顺序：ground → 色带 → 光照 → **水面** → 等高线。
// 水面压在光照之上是有意的：水面是平的，不该出现山体阴影的明暗。






const WATER_DEFAULTS = {
  level: 0.3,          // 量化表：低于 0.3 高度
  color: TOKENS.water, // #2b3a3d
  dpTolerance: 0.8,
  minRingExtent: 21,
  opacity: 1,
};

/**
 * @returns {{d:string, rings:number, length:number, stats:object, options:object}}
 */
function buildWaterLayer(field, config = {}) {
  const c = { ...WATER_DEFAULTS, ...config };
  const { paths, stats } = extractBandPolygons(field, -Infinity, c.level, { minRingExtent: c.minRingExtent });

  let d = '';
  let vertices = 0;
  for (const p of paths) {
    const reduced = simplify(p.points, c.dpTolerance);
    vertices += reduced.length;
    d += catmullRomPath(reduced, true);
  }

  return {
    d,
    rings: paths.length,
    length: stats.totalLength,
    vertices,
    stats,
    options: c,
    layer: { d, fill: c.color, fillOpacity: c.opacity, fillRule: 'evenodd' },
  };
}

/** 视口内（不含外扩区）低于水位的采样点占比，用来和渲染出来的水面像素占比对账。 */
function waterSampleFraction(field, level) {
  const inset = Math.round(field.pad / field.step);
  let below = 0;
  let total = 0;
  for (let j = inset; j <= field.rows - 1 - inset; j++) {
    const row = j * field.cols;
    for (let i = inset; i <= field.cols - 1 - inset; i++) {
      if (field.data[row + i] < level) below++;
      total++;
    }
  }
  return total ? below / total : 0;
}

// ---- src/svg.mjs ----
// SVG assembly.
//
// 只输出交给它的图层：没有滤镜、没有渐变、没有发光，也没有规格之外的任何装饰。
// 图层顺序即绘制顺序：调用方先给色带（低层级在下），再给等高线（画在填充之上）。



const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * @param {{width:number,height:number,background?:string,
 *          layers:Array<{d:string, fill?:string, fillOpacity?:number, fillRule?:string,
 *                        stroke?:string, strokeWidth?:number, strokeOpacity?:number}>,
 *          meta?:object}} spec
 */
function buildSvg(spec) {
  const { width, height, layers } = spec;
  const background = spec.background ?? TOKENS.ground;
  const meta = spec.meta ?? {};
  const metaAttrs = Object.entries(meta)
    .map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`)
    .join('');

  const body = layers
    .filter((l) => l.d || l.href)
    .map((l) => {
      if (l.kind === 'image') {
        return `    <image x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" preserveAspectRatio="none" href="${l.href}"/>`;
      }
      const attrs = [];
      if (l.fill) {
        attrs.push(`fill="${l.fill}"`, `fill-opacity="${l.fillOpacity}"`, `fill-rule="${l.fillRule ?? 'evenodd'}"`, 'stroke="none"');
      }
      if (l.stroke) {
        attrs.push(`stroke="${l.stroke}"`, `stroke-width="${l.strokeWidth}"`, `stroke-opacity="${l.strokeOpacity}"`);
      }
      return `    <path d="${l.d}" ${attrs.join(' ')}/>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision"${metaAttrs}>
  <defs>
    <clipPath id="viewport"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath>
  </defs>
  <rect id="ground" x="0" y="0" width="${width}" height="${height}" fill="${background}"/>
  <g clip-path="url(#viewport)" fill="none" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>
`;
}

/** 一条等高线图层（细线或索引线）。 */
function contourLayer(d, { index = false } = {}) {
  return {
    d,
    stroke: index ? TOKENS.indexContour : TOKENS.contour,
    strokeWidth: index ? STROKE.indexContour : STROKE.contour,
    strokeOpacity: index ? TOKENS.indexContourOpacity : TOKENS.contourOpacity,
  };
}

/** 一条色带图层：低透明度白叠加。 */
function bandLayer(d, { alpha, fill = '#ffffff' }) {
  return { d, fill, fillOpacity: alpha, fillRule: 'evenodd' };
}

// ---- src/generate.mjs ----
// 生成核心（浏览器安全：本文件不 import 任何宿主 API）。
//
//   buildTerrain(config)            纯计算：高度场 -> 色带 / 光照位图 / 水面 / 等高线
//   renderSvg(terrain, {encodePng}) 组装 SVG；PNG 编码器由调用方注入
//
// Node 侧封装见 src/node.mjs（zlib 同步），浏览器侧见 src/browser.mjs（CompressionStream 异步）。
// 两侧产出同一张图，只是编码器不同。











// 平台无关计时：performance 在浏览器与 Node 16+ 都有
const now =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

const GEN_DEFAULTS = {
  width: 1440,
  height: 1000,
  seed: 'isopleth-01',
  levels: [0.5],
  indexEvery: 5,       // 量化表：每 5 条一条索引线（1.4px）
  dpTolerance: 1.5,
  minPolylineLength: 40,
  minRingExtent: 21,
  bands: null,         // null = 不出色带；true 或 { bandCount, lightenStep, contourLevels }
  lighting: null,      // null = 不出光照；true 或 { azimuthDeg, altitudeDeg, relief, ... }
  water: null,         // null = 不出水面；true 或 { level, color }
  background: undefined, // 底色；不传 = TOKENS.ground（量化表：或跟随主题的 --th-bg）
  field: {},
};

/**
 * 纯计算，不产出字符串。
 * @returns {{width:number,height:number,layers:Array,bands:object|null,shade:object|null,
 *            water:object|null,stats:object,camera:object,timings:object,meta:object}}
 *
 * layers 是有序描述符：{kind:'band'|'shade'|'water'|'contour'}
 * 其中 shade 带原始 RGBA，渲染时才编码成内嵌 PNG。
 */
function buildTerrain(config = {}) {
  const c = { ...GEN_DEFAULTS, ...config };
  const fieldOpts = { ...FIELD_DEFAULTS, ...(config.field ?? {}) };

  const t0 = now();
  const field = buildField({ width: c.width, height: c.height, seed: c.seed, ...fieldOpts });
  const t1 = now();

  const layers = [];

  // ---- 色带（低层级在下，高层级在上）----
  let bandInfo = null;
  if (c.bands) {
    const b = { ...BAND_DEFAULTS, minRingExtent: c.minRingExtent, ...(c.bands === true ? {} : c.bands) };
    const contourLevels = b.contourLevels ?? c.levels;
    const built = buildBandLayers(field, { ...b, contourLevels });
    bandInfo = {
      bounds: built.bounds,
      stats: built.stats,
      bands: built.bands.map((x) => ({ index: x.index, low: x.low, high: x.high, alpha: x.alpha, rings: x.rings, dLength: x.d.length })),
    };
    for (const band of built.bands) {
      if (band.alpha > 0 && band.d) {
        layers.push({ ...bandLayer(band.d, { alpha: band.alpha }), kind: 'band', alpha: band.alpha });
      }
    }
  }
  const t2 = now();

  // ---- 单向光照（叠在色带之上、等高线之下；水面之上另说）----
  let shadeInfo = null;
  if (c.lighting) {
    const o = { ...SHADE_DEFAULTS, ...(c.lighting === true ? {} : c.lighting) };
    const shade = buildHillshade(field, o);
    layers.push({ kind: 'shade', rgba: shade.rgba, rgbaWidth: shade.width, rgbaHeight: shade.height });
    shadeInfo = { ...shade.stats, options: shade.options };
  }
  const t2b = now();

  // ---- 水面（压在光照之上：水面是平的，不该有山体阴影）----
  let waterInfo = null;
  if (c.water) {
    const w = { ...WATER_DEFAULTS, minRingExtent: c.minRingExtent, ...(c.water === true ? {} : c.water) };
    const water = buildWaterLayer(field, w);
    if (water.d) layers.push({ ...water.layer, kind: 'water' });
    waterInfo = {
      level: water.options.level,
      color: water.options.color,
      rings: water.rings,
      vertices: water.vertices,
      length: water.length,
    };
  }
  const t2c = now();

  // ---- 等高线（画在最上面）----
  const stats = {
    levels: [],
    kept: 0,
    rings: 0,
    open: 0,
    droppedShortOpen: 0,
    droppedSmallRing: 0,
    verticesAfterSimplify: 0,
    controlPoints: 0,
  };

  const ordinalOf = new Map();
  [...c.levels].sort((a, b) => a - b).forEach((level, i) => ordinalOf.set(level, i + 1));

  for (const level of c.levels) {
    const ordinal = ordinalOf.get(level);
    const isIndex = ordinal % c.indexEvery === 0;
    const { paths, stats: s } = extractIsolines(field, level, {
      minPolylineLength: c.minPolylineLength,
      minRingExtent: c.minRingExtent,
    });
    let d = '';
    for (const p of paths) {
      const reduced = simplify(p.points, c.dpTolerance);
      stats.verticesAfterSimplify += reduced.length;
      stats.controlPoints += p.points.length;
      d += catmullRomPath(reduced, p.closed);
    }
    stats.kept += s.kept;
    stats.rings += s.rings;
    stats.open += s.open;
    stats.droppedShortOpen += s.droppedShortOpen;
    stats.droppedSmallRing += s.droppedSmallRing;
    stats.levels.push({ level, ordinal, index: isIndex, ...s, dLength: d.length });
    layers.push({ kind: 'contour', d, level, index: isIndex, ...contourLayer(d, { index: isIndex }) });
  }
  const t3 = now();

  return {
    width: c.width,
    height: c.height,
    background: c.background,
    field,
    layers,
    bands: bandInfo,
    shade: shadeInfo,
    water: waterInfo,
    stats,
    camera: field.camera,
    meta: {
      generator: 'dsh-isopleth',
      step: c.water ? '4' : c.lighting ? '3' : c.bands ? '2' : '1',
      seed: c.seed,
    },
    timings: {
      fieldMs: t1 - t0,
      bandsMs: t2 - t1,
      shadeMs: t2b - t2,
      waterMs: t2c - t2b,
      isolineMs: t3 - t2c,
      geometryMs: t3 - t0,
    },
  };
}

const isThenable = (v) => !!v && typeof v.then === 'function';

/**
 * 组装 SVG。光照位图需要 PNG 编码器：
 *   encodePng(width, height, pixels, channels) -> Uint8Array | Promise<Uint8Array>
 * 返回 string（同步编码器）或 Promise<string>（异步编码器）。
 */
function renderSvg(terrain, { encodePng } = {}) {
  const assemble = (href) =>
    buildSvg({
      width: terrain.width,
      height: terrain.height,
      background: terrain.background,
      meta: terrain.meta,
      layers: terrain.layers.map((l) => {
        if (l.kind !== 'shade') return l;
        return {
          kind: 'image',
          href,
          x: 0,
          y: 0,
          width: terrain.width,
          height: terrain.height,
        };
      }),
    });

  const shade = terrain.layers.find((l) => l.kind === 'shade');
  if (!shade) return assemble(null);
  if (!encodePng) {
    throw new Error('renderSvg: 传入了光照但没给 encodePng；用 src/node.mjs（Node）或 src/browser.mjs（浏览器），或设 lighting: null');
  }

  const png = encodePng(shade.rgbaWidth, shade.rgbaHeight, shade.rgba, 4);
  const toHref = (bytes) => `data:image/png;base64,${bytesToBase64(bytes)}`;
  return isThenable(png) ? png.then((b) => assemble(toHref(b))) : assemble(toHref(png));
}

// ---- src/measure.mjs ----
// Measured contour spacing: along horizontal scanlines, collect every crossing of every
// level, then take the gaps between consecutive crossings. That gap is literally the
// on-screen distance between two neighbouring drawn contour lines.



function levelsFor(count) {
  const out = [];
  for (let k = 1; k <= count; k++) out.push(k / (count + 1));
  return out;
}

function medianContourSpacing(field, levelCount, { scanlines = 41 } = {}) {
  const levels = levelsFor(levelCount);
  const { cols, rows, step, data } = field;
  const gaps = [];
  const rowsUsed = Math.max(2, Math.min(rows, scanlines));
  const levelSet = levels.slice().sort((a, b) => a - b);

  for (let s = 0; s < rowsUsed; s++) {
    const j = Math.floor(((s + 0.5) * rows) / rowsUsed);
    if (j < 0 || j >= rows) continue;
    const row = j * cols;
    const xs = [];
    for (let i = 0; i < cols - 1; i++) {
      const a = data[row + i];
      const b = data[row + i + 1];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (const level of levelSet) {
        if (level >= lo && level < hi) {
          const t = (level - a) / (b - a);
          xs.push((i + t) * step);
        }
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 1; k < xs.length; k++) {
      const gap = xs[k] - xs[k - 1];
      if (gap > 0.5) gaps.push(gap);
    }
  }

  if (!gaps.length) return { median: null, p10: null, p90: null, samples: 0, levels };
  gaps.sort((a, b) => a - b);
  const pick = (q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))];
  return {
    median: pick(0.5),
    p10: pick(0.1),
    p90: pick(0.9),
    mean: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    samples: gaps.length,
    levels,
  };
}

/** Levels that actually produce geometry, for reporting. */
function levelCoverage(field, levelCount) {
  const out = [];
  for (const level of levelsFor(levelCount)) {
    const { stats } = extractIsolines(field, level);
    out.push({ level, kept: stats.kept, rings: stats.rings, open: stats.open, length: stats.totalLength });
  }
  return out;
}

// ---- src/browser.mjs ----
// 浏览器侧的生成入口：PNG 编码走 CompressionStream，**不含任何 Node API**。
//
//   import { createTerrainTexture } from './browser.mjs'
//   const svg = await createTerrainTexture({ width: 1440, height: 1000, seed: 'isopleth-01',
//                                            levels: levelsFor(9), bands: true, lighting: true, water: true })





/** 异步 PNG 编码器（CompressionStream 产出 zlib 流，正好是 PNG IDAT 需要的格式）。 */
function encodePngBrowser(width, height, pixels, channels = 1) {
  return pngBytes(width, height, pixels, channels, async (raw) => {
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  });
}

/** 默认一套「完整地形」参数。 */
function fullTerrainConfig(config = {}) {
  const levels = config.levels ?? levelsFor(9);
  return { levels, bands: true, lighting: true, water: true, ...config, levels };
}

/** @returns {Promise<string>} SVG 字符串 */
function createTerrainTexture(config = {}) {
  const terrain = buildTerrain(fullTerrainConfig(config));
  return Promise.resolve(renderSvg(terrain, { encodePng: encodePngBrowser })).then((svg) => svg);
}

/** 直接可用的 CSS 背景值。 */
async function terrainBackgroundCss(config = {}) {
  const svg = await createTerrainTexture(config);
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

// ---- plugin/entry.mjs ----
/**
 * dsh-isopleth / plugin
 *
 * 客户端插件形态：不依赖任何框架、不依赖宿主 API，只用 Web 标准（CompressionStream / matchMedia）。
 * 打包成单文件后可以直接像 platform-purple/dracula-map.js 那样注入渲染进程。
 *
 * 契约：
 *   - 只在初始化时生成一次，之后走缓存；重复 apply 不会重算，更没有每帧逻辑
 *   - 尊重 prefers-reduced-motion（无动画；只有显式要求 fadeIn 时才加过渡，且被该媒体查询关掉）
 *   - 失败不抛给宿主：apply() 返回 {ok:false, error}，并在 target 上留下 data-isopleth-error
 */




const PLUGIN_ID = 'dsh-isopleth';
const PLUGIN_VERSION = '0.4.0';

const PLUGIN_DEFAULTS = {
  seed: 'isopleth-01',
  width: 1440,
  height: 1000,
  levels: 9,
  bands: true,
  lighting: true,
  water: true,
  /** CSS：铺满容器且不重复（底纹本身就是完整一张图，禁止平铺） */
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  /** 可选淡入；prefers-reduced-motion: reduce 时自动跳过 */
  fadeIn: false,
  fadeInMs: 240,
};

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {Partial<typeof PLUGIN_DEFAULTS>} options
 */
function createIsoplethPlugin(options = {}) {
  const opts = { ...PLUGIN_DEFAULTS, ...options };

  let cache = null;     // { key, css, svg, bytes, ms }
  let inflight = null;  // { key, promise }
  let generations = 0;  // 生成次数，用来证明「只生成一次」

  const cacheKey = () =>
    [
      opts.seed, opts.width, opts.height, opts.levels,
      opts.bands ? 'b' : '-', opts.lighting ? 'l' : '-', opts.water ? 'w' : '-',
      opts.theme ? JSON.stringify(opts.theme) : '',
    ].join('|');

  /** 生成（或取缓存）。同一 key 并发调用只会真的算一次。 */
  function texture() {
    const key = cacheKey();
    if (cache && cache.key === key) return Promise.resolve(cache);
    if (inflight && inflight.key === key) return inflight.promise;

    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const promise = createTerrainTexture(
      fullTerrainConfig({
        seed: opts.seed,
        width: opts.width,
        height: opts.height,
        theme: opts.theme,
        ...(opts.terrain ?? {}),
      }),
    ).then((svg) => {
      const entry = {
        key,
        svg,
        css: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`,
        bytes: svg.length,
        ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0,
      };
      cache = entry;
      inflight = null;
      generations++;
      return entry;
    });

    inflight = { key, promise: promise.catch((e) => { inflight = null; throw e; }) };
    return inflight.promise;
  }

  /**
   * 应用到元素：把生成的 SVG 作为 background-image。
   * @returns {Promise<{ok:boolean, cached:boolean, ms:number, bytes:number, error?:string}>}
   */
  async function apply(target, applyOptions = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el || !el.style) return { ok: false, cached: false, ms: 0, bytes: 0, error: 'target missing' };

    const hit = !!(cache && cache.key === cacheKey());
    try {
      const entry = await texture();
      const o = { ...opts, ...applyOptions };

      if (o.fadeIn && !prefersReducedMotion()) {
        el.style.transition = `background-image ${o.fadeInMs}ms ease`;
      } else {
        el.style.transition = '';
      }
      el.style.backgroundImage = entry.css;
      el.style.backgroundSize = o.backgroundSize;
      el.style.backgroundPosition = o.backgroundPosition;
      el.style.backgroundRepeat = o.backgroundRepeat;
      el.setAttribute('data-isopleth-seed', String(opts.seed));
      el.removeAttribute('data-isopleth-error');
      return { ok: true, cached: hit, ms: Math.round(entry.ms), bytes: entry.bytes, generations };
    } catch (error) {
      el.setAttribute('data-isopleth-error', String((error && error.message) || error));
      return { ok: false, cached: hit, ms: 0, bytes: 0, error: String((error && error.message) || error) };
    }
  }

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    options: opts,
    texture,
    apply,
    /** 清缓存（换 seed / 换主题时调用）；下次 apply 会重新生成一次 */
    invalidate() { cache = null; },
    get stats() {
      return { generations, cachedBytes: cache ? cache.bytes : 0, cacheKey: cache ? cache.key : null };
    },
  };
}

/**
 * 给页面里所有 [data-isopleth] 元素套上底纹。
 *   <div data-isopleth data-seed="ridge-07" data-width="1440" data-height="1000"></div>
 */
async function autoMount(root = document) {
  const nodes = Array.from(root.querySelectorAll('[data-isopleth]'));
  const results = [];
  for (const el of nodes) {
    const plugin = createIsoplethPlugin({
      seed: el.getAttribute('data-seed') || PLUGIN_DEFAULTS.seed,
      width: Number(el.getAttribute('data-width')) || PLUGIN_DEFAULTS.width,
      height: Number(el.getAttribute('data-height')) || PLUGIN_DEFAULTS.height,
    });
    results.push(await plugin.apply(el));
  }
  return results;
}

  global.DSH_ISOPLETH = { PLUGIN_ID, PLUGIN_VERSION, PLUGIN_DEFAULTS, prefersReducedMotion, createIsoplethPlugin, autoMount };
})(typeof globalThis !== 'undefined' ? globalThis : self);
