// Catmull-Rom -> cubic Bezier conversion.

const f = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Build an SVG path `d` from a polyline, smoothed with a centripetal-free uniform
 * Catmull-Rom spline (tangent = (P[i+1] - P[i-1]) / 6).
 */
export function catmullRomPath(points, closed) {
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
