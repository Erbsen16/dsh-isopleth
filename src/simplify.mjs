// Douglas-Peucker simplification. Removes marching-squares lattice stepping before
// smoothing, which both shrinks the path data and removes grid-quantised wobble.

export function simplify(points, tolerance) {
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
