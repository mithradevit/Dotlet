/**
 * Freehand stroke engine.
 *
 * Raw pointer input is jittery and unevenly sampled, so a stroke goes through
 * three stages before it is drawn:
 *
 *   1. stabilise  — Procreate-style StreamLine. The pen chases the cursor
 *                   instead of snapping to it, which removes hand tremor.
 *   2. width      — a per-point radius from the brush (pressure, speed, or nib
 *                   angle, depending on the brush).
 *   3. outline    — the centre line is expanded into a closed polygon, so the
 *                   result is a real filled path rather than a stroked line.
 *                   That keeps variable width exportable as plain vector.
 *
 * Nothing here uses SVG filters — every brush exports as ordinary geometry, so
 * it survives Figma, Illustrator and Inkscape intact.
 */

import type { BrushSettings, BrushType } from '../types';

export interface SPoint { x: number; y: number; p: number }

/** Flat [x,y,p,...] → point objects. */
export function toPoints(flat: number[]): SPoint[] {
  const out: SPoint[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push({ x: flat[i], y: flat[i + 1], p: flat[i + 2] });
  }
  return out;
}

/**
 * StreamLine. `amount` 0..100 — the fraction of the remaining distance the pen
 * refuses to travel each sample. Applied incrementally while drawing so the
 * live stroke and the committed stroke are identical.
 */
export function stabilise(prev: SPoint, next: SPoint, amount: number): SPoint {
  const t = 1 - Math.min(0.95, Math.max(0, amount / 100));
  return {
    x: prev.x + (next.x - prev.x) * t,
    y: prev.y + (next.y - prev.y) * t,
    p: prev.p + (next.p - prev.p) * t,
  };
}

/** Per-point radii for a brush. */
function radii(pts: SPoint[], brush: BrushSettings): number[] {
  const base = brush.size / 2;
  const n = pts.length;
  const out = new Array<number>(n);

  // Speed in px/sample, smoothed — used by the tapering brushes.
  const speed = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    speed[i] = speed[i - 1] * 0.7 + d * 0.3;
  }

  const nib = (brush.angle * Math.PI) / 180;

  for (let i = 0; i < n; i++) {
    let r = base;
    switch (brush.type) {
      case 'pen':
        break;
      case 'marker':
        break;
      case 'pen-taper': {
        // Faster ⇒ thinner, the way a real nib lightens on a quick flick.
        const s = Math.min(1, speed[i] / 12);
        r = base * (0.35 + 0.65 * (1 - s)) * (0.4 + 0.6 * pts[i].p);
        break;
      }
      case 'calligraphy': {
        // Width collapses when travelling along the nib, widens across it.
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(n - 1, i + 1)];
        const dir = Math.atan2(next.y - prev.y, next.x - prev.x);
        r = base * Math.max(0.12, Math.abs(Math.sin(dir - nib)));
        break;
      }
      case 'pencil':
        r = base * (0.5 + 0.5 * pts[i].p);
        break;
    }
    out[i] = Math.max(0.15, r);
  }

  // Taper the ends so strokes start and finish at a point, not a blunt cap.
  if (brush.type === 'pen-taper' || brush.type === 'calligraphy') {
    const ramp = Math.min(8, Math.floor(n / 3));
    for (let i = 0; i < ramp; i++) {
      const k = (i + 1) / (ramp + 1);
      out[i] *= k;
      out[n - 1 - i] *= k;
    }
  }
  return out;
}

/**
 * Expand a centre line into a closed outline polygon.
 * Walks one side, round-caps the end, walks back the other side.
 */
export function outlinePath(pts: SPoint[], brush: BrushSettings): string {
  if (pts.length === 0) return '';

  const r = radii(pts, brush);

  // A single tap is just a dot.
  if (pts.length === 1) {
    const { x, y } = pts[0];
    const rr = r[0];
    return `M ${f(x - rr)} ${f(y)} a ${f(rr)} ${f(rr)} 0 1 0 ${f(rr * 2)} 0 a ${f(rr)} ${f(rr)} 0 1 0 ${f(-rr * 2)} 0 Z`;
  }

  const left: SPoint[] = [];
  const right: SPoint[] = [];

  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    // Normal is the direction rotated 90°.
    const nx = -dy, ny = dx;
    left.push({ x: pts[i].x + nx * r[i], y: pts[i].y + ny * r[i], p: 0 });
    right.push({ x: pts[i].x - nx * r[i], y: pts[i].y - ny * r[i], p: 0 });
  }

  // Quadratic through midpoints keeps the edge smooth without fitting curves.
  const side = (list: SPoint[]) => {
    let d = '';
    for (let i = 1; i < list.length; i++) {
      const mx = (list[i - 1].x + list[i].x) / 2;
      const my = (list[i - 1].y + list[i].y) / 2;
      d += ` Q ${f(list[i - 1].x)} ${f(list[i - 1].y)} ${f(mx)} ${f(my)}`;
    }
    const last = list[list.length - 1];
    d += ` L ${f(last.x)} ${f(last.y)}`;
    return d;
  };

  const endR = r[r.length - 1];
  const startR = r[0];
  const rev = right.slice().reverse();

  return (
    `M ${f(left[0].x)} ${f(left[0].y)}` +
    side(left) +
    ` A ${f(endR)} ${f(endR)} 0 0 1 ${f(rev[0].x)} ${f(rev[0].y)}` +
    side(rev) +
    ` A ${f(startR)} ${f(startR)} 0 0 1 ${f(left[0].x)} ${f(left[0].y)} Z`
  );
}

export interface Stamp { x: number; y: number; r: number; o: number }

/**
 * Pencil grain. Rendered as many small marks scattered along the path rather
 * than a filter, so the texture survives export as ordinary shapes.
 * Deterministic per stroke — the same stroke always grains identically.
 */
export function pencilStamps(pts: SPoint[], brush: BrushSettings, seed = 1): Stamp[] {
  const out: Stamp[] = [];
  const base = brush.size / 2;
  const density = 0.4 + (brush.grain / 100) * 1.6;

  // Small deterministic PRNG — Math.random would re-grain on every render.
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.round(dist * density));
    for (let k = 0; k < count; k++) {
      const t = k / count;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const spread = base * (0.5 + rnd() * 0.9);
      const ang = rnd() * Math.PI * 2;
      const mag = Math.sqrt(rnd()) * spread;
      out.push({
        x: px + Math.cos(ang) * mag,
        y: py + Math.sin(ang) * mag,
        r: base * (0.06 + rnd() * 0.16),
        o: 0.25 + rnd() * 0.6,
      });
    }
  }
  return out;
}

const f = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0');

/** Sensible starting settings per brush. */
export const BRUSH_PRESETS: Record<BrushType, BrushSettings> = {
  'pen':         { type: 'pen',         size: 8,  opacity: 100, streamline: 35, angle: 45, grain: 50 },
  'pen-taper':   { type: 'pen-taper',   size: 14, opacity: 100, streamline: 45, angle: 45, grain: 50 },
  'calligraphy': { type: 'calligraphy', size: 22, opacity: 100, streamline: 40, angle: 45, grain: 50 },
  'pencil':      { type: 'pencil',      size: 14, opacity: 85,  streamline: 20, angle: 45, grain: 60 },
  'marker':      { type: 'marker',      size: 26, opacity: 45,  streamline: 40, angle: 45, grain: 50 },
};

export const BRUSH_LABELS: Record<BrushType, string> = {
  'pen': 'Pen',
  'pen-taper': 'Taper',
  'calligraphy': 'Calligraphy',
  'pencil': 'Pencil',
  'marker': 'Marker',
};
