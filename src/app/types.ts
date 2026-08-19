export type DotShape =
  | 'circle'
  | 'rectangle'
  | 'diamond'
  | 'teardrop'
  | 'star4'
  | 'cross'
  | 'hexagon'
  | 'crescent';

export type Tool = 'pen' | 'eraser' | 'move' | 'hand';

/**
 * Dots snap to the 60px lattice and merge via the gooey filter.
 * Freehand records raw pointer paths — a different document type, not a setting.
 */
export type CanvasMode = 'dots' | 'freehand';

export type BrushType =
  | 'pen'            // solid, constant width
  | 'pen-taper'      // solid, thins with speed, tapered ends
  | 'calligraphy'    // width from stroke angle vs a fixed nib angle
  | 'pencil'         // grainy graphite, stamped marks
  | 'marker';        // thick, semi-transparent, multiplies where it overlaps

export interface BrushSettings {
  type: BrushType;
  size: number;        // nib width in px at full pressure
  opacity: number;     // 0..100
  /** Procreate-style StreamLine: 0 = raw input, 100 = heavy lag/smoothing. */
  streamline: number;
  /** Nib angle in degrees, calligraphy only. */
  angle: number;
  /** Grain density, pencil only. */
  grain: number;
}

/**
 * A text label anchored to canvas space. Exports as a real SVG <text>, so it
 * stays editable copy in Figma/Illustrator rather than being flattened.
 */
export interface TextItem {
  id: string;
  x: number;
  y: number;
  /** Raw text; newlines become separate tspans. */
  text: string;
  size: number;
  color: string;
  layerId?: string;
}

/** A single freehand mark. Points are in canvas logical space. */
export interface Stroke {
  id: string;
  /** Flat [x, y, pressure] triples — flat array keeps long strokes cheap. */
  points: number[];
  color: string;
  brush: BrushSettings;
  layerId?: string;
  groupId?: string;
}
export type ClusterMode = 'blend' | 'separate';
export type ExportMode = 'crisp' | 'gooey';
export type GridSize = number; // Allow any number for 1-to-1 mapping

export interface Dot {
  id: string;
  col: number;
  row: number;
  shape: DotShape;
  clusterId: number;
  markId: number;
  layerId?: string;
  colorOverride?: string;
  sizeOverride?: number;
  /**
   * Grouping is an explicit user action (Cmd/Ctrl+G), distinct from `markId`
   * (one pen stroke) and `clusterId` (gooey blend set). Selecting any dot of a
   * group selects the whole group.
   */
  groupId?: string;
}

export interface CanvasLayer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

export const DOT_SHAPES: DotShape[] = [
  'circle',
  'rectangle',
  'diamond',
  'teardrop',
  'star4',
  'cross',
  'hexagon',
  'crescent',
];

export const DOT_SHAPE_LABELS: Record<DotShape, string> = {
  circle: 'Circle',
  rectangle: 'Rect',
  diamond: 'Diamond',
  teardrop: 'Tear',
  star4: 'Star',
  cross: 'Cross',
  hexagon: 'Hex',
  crescent: 'Moon',
};

export const GRID_SIZES: GridSize[] = [8, 12, 16, 24, 32];
