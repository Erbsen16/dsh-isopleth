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
export function extractIsolines(field, level, opts = {}) {
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
export function extractBandPolygons(field, low, high, opts = {}) {
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
