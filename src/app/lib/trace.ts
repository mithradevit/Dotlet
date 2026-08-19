/**
 * Alpha-mask → vector outline tracing.
 *
 * The gooey look is produced by an SVG filter chain (Gaussian blur + an
 * feColorMatrix alpha threshold). Figma ignores feColorMatrix, so a filtered
 * SVG renders there as a blur with no re-sharpening. To get an identical result
 * in every renderer we rasterise the filtered artwork once (the browser applies
 * the filter correctly), then trace the resulting alpha mask back into real
 * paths — so the exported file needs no filter support at all.
 *
 * Pipeline: marching squares (sub-pixel interpolated) → ring linking →
 * Ramer–Douglas–Peucker simplification → SVG path data.
 */

export type Pt = [number, number];

/**
 * Marching-squares case table. Bits: 1=TL 2=TR 4=BR 8=BL. Edges: T R B L.
 *
 * Segments are DIRECTED and mutually consistent (the inside region always sits
 * on the same side), so a segment's end point is exactly the next segment's
 * start point. That is what lets linkRings() chain them head-to-tail; an
 * unoriented table produces fragments that cannot be walked into closed rings.
 */
const CASES: Record<number, [string, string][]> = {
  1:  [['T', 'L']],
  2:  [['R', 'T']],
  3:  [['R', 'L']],
  4:  [['B', 'R']],
  5:  [['T', 'L'], ['B', 'R']],
  6:  [['B', 'T']],
  7:  [['B', 'L']],
  8:  [['L', 'B']],
  9:  [['T', 'B']],
  10: [['R', 'T'], ['L', 'B']],
  11: [['R', 'B']],
  12: [['L', 'R']],
  13: [['T', 'R']],
  14: [['L', 'T']],
};

/**
 * Extract iso-contours from a scalar field.
 * @param a   row-major alpha samples, 0..1
 * @param iso threshold (0.5 matches the filter's own alpha cutoff)
 * @returns closed rings in sample coordinates
 */
export function traceContours(a: Float32Array, w: number, h: number, iso = 0.5): Pt[][] {
  const at = (x: number, y: number) => a[y * w + x];

  const lerp = (p: Pt, v: number, q: Pt, u: number): Pt => {
    const d = u - v;
    const t = Math.abs(d) < 1e-9 ? 0.5 : (iso - v) / d;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };

  const segments: [Pt, Pt][] = [];

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v0 = at(x, y), v1 = at(x + 1, y), v2 = at(x + 1, y + 1), v3 = at(x, y + 1);
      let idx = 0;
      if (v0 >= iso) idx |= 1;
      if (v1 >= iso) idx |= 2;
      if (v2 >= iso) idx |= 4;
      if (v3 >= iso) idx |= 8;
      const cases = CASES[idx];
      if (!cases) continue;

      const c0: Pt = [x, y], c1: Pt = [x + 1, y], c2: Pt = [x + 1, y + 1], c3: Pt = [x, y + 1];
      const edge = (e: string): Pt => {
        switch (e) {
          case 'T': return lerp(c0, v0, c1, v1);
          case 'R': return lerp(c1, v1, c2, v2);
          case 'B': return lerp(c3, v3, c2, v2);
          default:  return lerp(c0, v0, c3, v3);
        }
      };
      for (const [from, to] of cases) segments.push([edge(from), edge(to)]);
    }
  }

  return linkRings(segments);
}

/**
 * Chain directed segments into closed rings.
 *
 * Adjacent cells interpolate the shared edge from identical corner values, so
 * the crossing points coincide exactly and can be matched by quantised key.
 */
function linkRings(segments: [Pt, Pt][]): Pt[][] {
  const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;

  // start point -> segments beginning there
  const bucket = new Map<string, number[]>();
  segments.forEach((s, i) => {
    const k = key(s[0]);
    const list = bucket.get(k);
    if (list) list.push(i); else bucket.set(k, [i]);
  });

  const used = new Array<boolean>(segments.length).fill(false);
  const rings: Pt[][] = [];

  const takeFrom = (k: string): number => {
    const list = bucket.get(k);
    if (!list) return -1;
    for (const i of list) if (!used[i]) return i;
    return -1;
  };

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;

    const ring: Pt[] = [segments[start][0]];
    let cur = start;
    used[cur] = true;

    for (let guard = 0; guard <= segments.length; guard++) {
      const end = segments[cur][1];
      ring.push(end);
      const endKey = key(end);
      if (endKey === key(ring[0])) break;      // closed
      const next = takeFrom(endKey);
      if (next === -1) break;                  // open contour (hits raster edge)
      used[next] = true;
      cur = next;
    }

    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Ramer–Douglas–Peucker. Drops collinear noise from the staircase. */
export function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;

  const dist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };

  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let best = -1, bestD = epsilon;
    for (let i = lo + 1; i < hi; i++) {
      const d = dist(points[i], points[lo], points[hi]);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best !== -1) {
      keep[best] = 1;
      stack.push([lo, best], [best, hi]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Trace an alpha channel into SVG path data.
 *
 * @param alpha    RGBA pixel buffer (only the alpha byte is read)
 * @param w,h      raster dimensions
 * @param scale    raster samples per SVG user unit
 * @param originX,originY  SVG user-space coordinate of raster pixel (0,0)
 * @param tolerance simplification tolerance, in SVG user units
 */
export function alphaToPathData(
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  scale: number,
  originX: number,
  originY: number,
  tolerance = 0.35,
): string {
  // Pad by one sample so shapes touching the raster edge still close cleanly.
  const pw = w + 2, ph = h + 2;
  const field = new Float32Array(pw * ph);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      field[(y + 1) * pw + (x + 1)] = alpha[(y * w + x) * 4 + 3] / 255;
    }
  }

  const rings = traceContours(field, pw, ph, 0.5);
  const parts: string[] = [];

  for (const ring of rings) {
    const simplified = simplify(ring, tolerance * scale);
    if (simplified.length < 3) continue;
    const pts = simplified.map(([x, y]): Pt => [
      originX + (x - 1) / scale,
      originY + (y - 1) / scale,
    ]);
    const f = (n: number) => n.toFixed(2);
    parts.push(
      `M ${f(pts[0][0])} ${f(pts[0][1])} ` +
      pts.slice(1).map(p => `L ${f(p[0])} ${f(p[1])}`).join(' ') +
      ' Z'
    );
  }

  return parts.join(' ');
}
