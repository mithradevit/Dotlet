import React, { useMemo } from 'react';
import type { Stroke } from '../types';
import { toPoints, outlinePath, pencilStamps } from '../lib/stroke';

/** Stable numeric seed from a stroke id, so grain never re-randomises. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * One freehand stroke as plain SVG geometry.
 *
 * Pencil renders as scattered marks (real shapes, so the grain survives export);
 * every other brush is a single filled outline path. No filters are used, so
 * strokes render identically in Figma and other filter-limited apps.
 */
export const StrokeShape = React.memo(function StrokeShape({ stroke }: { stroke: Stroke }) {
  const pts = useMemo(() => toPoints(stroke.points), [stroke.points]);
  const opacity = stroke.brush.opacity / 100;

  if (pts.length === 0) return null;

  if (stroke.brush.type === 'pencil') {
    const stamps = pencilStamps(pts, stroke.brush, seedOf(stroke.id));
    return (
      <g opacity={opacity}>
        {stamps.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={stroke.color} opacity={s.o} />
        ))}
      </g>
    );
  }

  const d = outlinePath(pts, stroke.brush);
  if (!d) return null;

  return (
    <path
      d={d}
      fill={stroke.color}
      opacity={opacity}
      // Marker darkens where it overlaps itself, like a real highlighter.
      style={stroke.brush.type === 'marker' ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
});

export function StrokeLayer({ strokes }: { strokes: Stroke[] }) {
  return (
    <>
      {strokes.map(s => <StrokeShape key={s.id} stroke={s} />)}
    </>
  );
}
