import React from 'react';
import type { DotShape } from '../types';

/** Returns the SVG path `d` string for path-based shapes. Returns null for circle/rect. */
export function getDotPathD(shape: DotShape, cx: number, cy: number, r: number): string | null {
  const f = (n: number) => n.toFixed(3);

  switch (shape) {
    case 'circle':
    case 'rectangle':
      return null;

    case 'diamond':
      return `M ${f(cx)} ${f(cy - r)} L ${f(cx + r)} ${f(cy)} L ${f(cx)} ${f(cy + r)} L ${f(cx - r)} ${f(cy)} Z`;

    case 'teardrop':
      // Round bottom, tapered tip at top
      return [
        `M ${f(cx)} ${f(cy + r)}`,
        `C ${f(cx + r)} ${f(cy + r)} ${f(cx + r)} ${f(cy - r * 0.25)} ${f(cx)} ${f(cy - r)}`,
        `C ${f(cx - r)} ${f(cy - r * 0.25)} ${f(cx - r)} ${f(cy + r)} ${f(cx)} ${f(cy + r)}`,
        'Z',
      ].join(' ');

    case 'star4': {
      const inner = r * 0.38;
      const pts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4 - Math.PI / 2;
        const rad = i % 2 === 0 ? r : inner;
        pts.push(`${i === 0 ? 'M' : 'L'} ${f(cx + Math.cos(angle) * rad)} ${f(cy + Math.sin(angle) * rad)}`);
      }
      return pts.join(' ') + ' Z';
    }

    case 'cross': {
      const arm = r * 0.35;
      return [
        `M ${f(cx - arm)} ${f(cy - r)}`,
        `L ${f(cx + arm)} ${f(cy - r)}`,
        `L ${f(cx + arm)} ${f(cy - arm)}`,
        `L ${f(cx + r)} ${f(cy - arm)}`,
        `L ${f(cx + r)} ${f(cy + arm)}`,
        `L ${f(cx + arm)} ${f(cy + arm)}`,
        `L ${f(cx + arm)} ${f(cy + r)}`,
        `L ${f(cx - arm)} ${f(cy + r)}`,
        `L ${f(cx - arm)} ${f(cy + arm)}`,
        `L ${f(cx - r)} ${f(cy + arm)}`,
        `L ${f(cx - r)} ${f(cy - arm)}`,
        `L ${f(cx - arm)} ${f(cy - arm)}`,
        'Z',
      ].join(' ');
    }

    case 'hexagon': {
      const pts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        pts.push(`${i === 0 ? 'M' : 'L'} ${f(cx + Math.cos(angle) * r)} ${f(cy + Math.sin(angle) * r)}`);
      }
      return pts.join(' ') + ' Z';
    }

    case 'crescent': {
      // Outer large arc (left half), inner smaller arc cuts from right
      // Produces a right-facing crescent (moon)
      const innerR = r * 0.7;
      return [
        `M ${f(cx)} ${f(cy - r)}`,
        `A ${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${f(cy + r)}`,
        `A ${f(innerR)} ${f(innerR)} 0 1 0 ${f(cx)} ${f(cy - r)}`,
        'Z',
      ].join(' ');
    }
  }
}

interface DotElementProps {
  key?: React.Key;
  shape: DotShape;
  cx: number;
  cy: number;
  r: number;
  fill: string;
  className?: string;
}

export function renderDotElement({ key, shape, cx, cy, r, fill, className }: DotElementProps): React.ReactElement {
  const pathD = getDotPathD(shape, cx, cy, r);

  if (shape === 'circle') {
    return <circle key={key} cx={cx} cy={cy} r={r} fill={fill} className={className} />;
  }

  if (shape === 'rectangle') {
    const side = r * 2;
    const rx = side * 0.08;
    return (
      <rect
        key={key}
        x={cx - r} y={cy - r}
        width={side} height={side}
        rx={rx}
        fill={fill}
        className={className}
      />
    );
  }

  return <path key={key} d={pathD!} fill={fill} className={className} />;
}

/** Tiny preview SVG used inside palette buttons */
export function ShapePreview({ shape, size = 20, color = 'currentColor' }: { shape: DotShape; size?: number; color?: string }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42; // preview sits inside its button — slightly smaller than canvas ratio
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {renderDotElement({ shape, cx, cy, r, fill: color })}
    </svg>
  );
}

/**
 * Returns the SVG string for a dot.
 * @param useClass  true  → class="dot"  (SVG export — colour editable via CSS)
 *                  false → fill="…"     (PNG raster — canvas renderer ignores CSS)
 * @param inlineFill  hex colour used when useClass=false
 */
export function getDotSVGString(
  shape: DotShape,
  cx: number,
  cy: number,
  r: number,
  useClass: boolean,
  inlineFill = '#000000',
): string {
  const f = (n: number) => n.toFixed(3);
  const attr = useClass ? 'class="dot"' : `fill="${inlineFill}"`;

  if (shape === 'circle') {
    return `<circle ${attr} cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>`;
  }
  if (shape === 'rectangle') {
    const side = r * 2;
    const rx = side * 0.08;
    return `<rect ${attr} x="${f(cx - r)}" y="${f(cy - r)}" width="${f(side)}" height="${f(side)}" rx="${f(rx)}"/>`;
  }
  const d = getDotPathD(shape, cx, cy, r)!;
  return `<path ${attr} d="${d}"/>`;
}
