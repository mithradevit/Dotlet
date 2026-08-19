import React, {
  useRef, useState, useCallback, useMemo, useEffect,
  forwardRef, useImperativeHandle,
} from 'react';
import type {
  Dot, Tool, DotShape, ClusterMode, GridSize, CanvasLayer,
  CanvasMode, Stroke, BrushSettings,
} from '../types';
import { renderDotElement } from './dotShapes';
import { StrokeShape } from './StrokeRender';
import { stabilise, type SPoint } from '../lib/stroke';

// ---- constants ----
export const CELL = 60;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const FilterDef = React.memo(({
  id, spread, crispness, roughness, outlineMode, outlineWeight, shadowOpacity, shadowBlur, CELL
}: {
  id: string, spread: number, crispness: number, roughness: number, outlineMode: boolean,
  outlineWeight: number, shadowOpacity: number, shadowBlur: number, CELL: number
}) => {
  const stdDev = Math.pow(spread / 100, 1.8) * CELL;
  const colorMatrix = `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${crispness * 2} ${-crispness}`;
  const roughFreq = roughness > 0 ? (roughness / 100) * 0.06 : 0;
  const roughScale = roughness > 0 ? (roughness / 100) * CELL * 0.4 : 0;
  const shadowA = shadowOpacity / 100;

  const threshold = outlineMode ? (<>
    <feGaussianBlur in="SourceGraphic" stdDeviation={stdDev} result="blur" />
    <feColorMatrix in="blur" mode="matrix" values={colorMatrix} result="thresh" />
    {roughness > 0 && <>
      <feTurbulence type="fractalNoise" baseFrequency={roughFreq} numOctaves={3} seed={2} result="noise" />
      <feDisplacementMap in="thresh" in2="noise" scale={roughScale} xChannelSelector="R" yChannelSelector="G" result="rough" />
    </>}
    <feMorphology in={roughness > 0 ? 'rough' : 'thresh'} operator="dilate" radius={outlineWeight} result="dilated" />
    <feComposite in="dilated" in2={roughness > 0 ? 'rough' : 'thresh'} operator="xor" result="shape" />
  </>) : (<>
    <feGaussianBlur in="SourceGraphic" stdDeviation={stdDev} result="blur" />
    <feColorMatrix in="blur" mode="matrix" values={colorMatrix} result="thresh" />
    {roughness > 0 && <>
      <feTurbulence type="fractalNoise" baseFrequency={roughFreq} numOctaves={3} seed={2} result="noise" />
      <feDisplacementMap in="thresh" in2="noise" scale={roughScale} xChannelSelector="R" yChannelSelector="G" result="shape" />
    </>}
  </>);

  const finalResult = outlineMode ? 'shape' : roughness > 0 ? 'shape' : 'thresh';

  if (shadowA > 0) {
    return (
      <filter id={id} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
        {threshold}
        <feGaussianBlur in={finalResult} stdDeviation={shadowBlur * 0.5} result="shadowBlur" />
        <feColorMatrix in="shadowBlur" mode="matrix"
          values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${shadowA * 3} 0`} result="shadow" />
        <feMerge>
          <feMergeNode in="shadow" />
          <feMergeNode in={finalResult} />
        </feMerge>
      </filter>
    );
  }
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
      {threshold}
    </filter>
  );
});

export interface CanvasHandle {
  zoomToFit: () => void;
  zoomTo100: () => void;
  /** Select these dot ids (expanded to whole groups). Used by the Layers panel. */
  selectIds: (ids: string[]) => void;
}

interface CanvasProps {
  dots: Dot[];
  tool: Tool;
  dotShape: DotShape;
  dotColor: string;
  bgColor: string;
  gridSize: GridSize;
  showGrid: boolean;
  spread: number;
  crispness: number;
  outlineMode: boolean;
  outlineWeight: number;
  roughness: number;
  shadowOpacity: number;
  shadowBlur: number;
  clusterMode: ClusterMode;
  bgLayerVisible: boolean;
  artLayerVisible: boolean;
  customLayers: CanvasLayer[];
  /** Layer new dots are drawn into. null = the built-in Artwork layer. */
  activeLayerId: string | null;
  nextMarkId: React.MutableRefObject<number>;
  nextClusterId: React.MutableRefObject<number>;
  onMarkComplete: (finalDots: Dot[]) => void;
  onZoomChange: (z: number) => void;
  /** Mirrors the move-tool selection up to App (for grouping / export). */
  onSelectionChange?: (ids: string[]) => void;
  // ── Freehand mode ──
  mode: CanvasMode;
  strokes: Stroke[];
  brush: BrushSettings;
  onStrokeComplete: (s: Stroke) => void;
  onEraseStrokes: (ids: string[]) => void;
}

export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  {
    dots, tool, dotShape, dotColor, bgColor,
    gridSize, showGrid,
    spread, crispness, outlineMode, outlineWeight,
    roughness, shadowOpacity, shadowBlur,
    clusterMode, bgLayerVisible, artLayerVisible,
    customLayers, activeLayerId,
    nextMarkId, nextClusterId,
    onMarkComplete, onZoomChange, onSelectionChange,
    mode, strokes, brush, onStrokeComplete, onEraseStrokes,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Holds the latest expandToGroups so the imperative handle (declared above it)
  // can reach it without a forward reference.
  const expandToGroupsRef = useRef<(ids: Set<string>) => Set<string>>(s => s);
  // Same forward-reference dodge: the freehand handlers are declared above
  // getLogical but only ever run after it exists.
  const getLogicalRef = useRef<(cx: number, cy: number) => { x: number; y: number }>(
    () => ({ x: 0, y: 0 })
  );
  const gridW = gridSize * CELL;
  const gridH = gridSize * CELL;
  const dotR = CELL * 0.56;

  // ---- viewport ----
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [panActive, setPanActive] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const isPanning = useRef(false);
  const panAnchor = useRef({ clientX: 0, clientY: 0, panX: 0, panY: 0 });

  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; onZoomChange(zoom); }, [zoom, onZoomChange]);

  const zoomToFit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Fit the grid box *and* any artwork outside it. Dots are not clamped to the
    // grid, so fitting the grid alone pushes off-grid artwork out of view —
    // which, on a grid-size change, reads as "my drawing disappeared".
    let minX = 0, minY = 0, maxX = gridW, maxY = gridH;
    for (const d of dots) {
      minX = Math.min(minX, d.col * CELL);
      minY = Math.min(minY, d.row * CELL);
      maxX = Math.max(maxX, (d.col + 1) * CELL);
      maxY = Math.max(maxY, (d.row + 1) * CELL);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const z = clamp(Math.min(el.offsetHeight * 0.8 / h, el.offsetWidth * 0.8 / w), ZOOM_MIN, ZOOM_MAX);
    setZoom(z);
    setPan({
      x: (el.offsetWidth - w * z) / 2 - minX * z,
      y: (el.offsetHeight - h * z) / 2 - minY * z,
    });
  }, [gridW, gridH, dots]);

  const zoomTo100 = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setZoom(1);
    setPan({ x: (el.offsetWidth - gridW) / 2, y: (el.offsetHeight - gridH) / 2 });
  }, [gridW, gridH]);

  useImperativeHandle(ref, () => ({
    zoomToFit,
    zoomTo100,
    selectIds: (ids: string[]) => setSelectedIds(expandToGroupsRef.current(new Set(ids))),
  }), [zoomToFit, zoomTo100]);
  useEffect(() => { zoomToFit(); }, []); // eslint-disable-line
  useEffect(() => { zoomToFit(); }, [gridSize]); // eslint-disable-line

  // ---- space bar ----
  useEffect(() => {
    // Space is only a pan modifier when focus is not in a text field — otherwise
    // preventDefault() would swallow spaces typed into the composer / rename inputs.
    const isTextTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTextTarget(e.target)) return;
      e.preventDefault();
      setSpaceHeld(true);
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    // Window blur (alt-tab while holding space) never delivers keyup — clear it.
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // ---- wheel zoom ----
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.ctrlKey ? Math.pow(0.995, e.deltaY) : e.deltaY < 0 ? 1.12 : 1 / 1.12;
    // Derive both values from the refs and set them independently. Calling setPan
    // from inside the setZoom updater makes the updater impure — React StrictMode
    // double-invokes it and the pan gets applied twice.
    const prev = zoomRef.current;
    const next = clamp(prev * factor, ZOOM_MIN, ZOOM_MAX);
    if (next === prev) return;
    const ratio = next / prev;
    const p = panRef.current;
    const nextPan = { x: cx - ratio * (cx - p.x), y: cy - ratio * (cy - p.y) };
    zoomRef.current = next;
    panRef.current = nextPan;
    setZoom(next);
    setPan(nextPan);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ---- pen/eraser draw state ----
  const [markDots, setMarkDots] = useState<Dot[]>([]);
  const [erasedIds, setErasedIds] = useState<Set<string>>(new Set());
  const [animIds, setAnimIds] = useState<Set<string>>(new Set());
  const isDrawing = useRef(false);
  const visitedNodes = useRef<Set<string>>(new Set());
  const markIdRef = useRef(0);
  const clusterIdRef = useRef(0);
  const strokeToolRef = useRef<Tool>('pen');
  // Always-current mirror of dotColor so pointer handlers (useCallback) can
  // read the live value without being added to their dependency arrays.
  const dotColorRef = useRef(dotColor);
  useEffect(() => { dotColorRef.current = dotColor; }, [dotColor]);
  // Locked for the duration of a single stroke — prevents mid-stroke colour shifts.
  const strokeColorRef = useRef(dotColor);
  // Same idea for the target layer: locked at stroke start so switching layers
  // mid-drag can't split one stroke across two layers.
  const strokeLayerRef = useRef<string | null>(null);

  // Layer + colour fields for a newly drawn dot.
  //
  // Colour is always the user's picked colour, on every layer. A layer groups
  // dots and controls their visibility; it does not dictate their colour. The
  // swatch on a layer row is an identity tag only.
  const layerStamp = useCallback((): Pick<Dot, 'layerId' | 'colorOverride'> => (
    strokeLayerRef.current
      ? { layerId: strokeLayerRef.current, colorOverride: strokeColorRef.current }
      : { colorOverride: strokeColorRef.current }
  ), []);

  // ---- freehand state ----
  // The in-progress stroke lives here and is committed to App on pointer-up, so
  // a long stroke doesn't push a history entry per sample.
  const [live, setLive] = useState<Stroke | null>(null);
  const liveRef = useRef<Stroke | null>(null);
  const lastPtRef = useRef<SPoint | null>(null);
  const isFreehandDrawing = useRef(false);

  const pushLivePoint = useCallback((clientX: number, clientY: number, pressure: number) => {
    const { x, y } = getLogicalRef.current(clientX, clientY);
    const raw: SPoint = { x, y, p: pressure > 0 ? pressure : 0.5 };
    const prev = lastPtRef.current;
    // StreamLine: chase the cursor instead of snapping, killing hand tremor.
    const pt = prev ? stabilise(prev, raw, brush.streamline) : raw;
    lastPtRef.current = pt;

    const cur = liveRef.current;
    if (!cur) return;
    // Drop samples that barely moved — long strokes stay cheap to render.
    const n = cur.points.length;
    if (n >= 3) {
      const dx = pt.x - cur.points[n - 3];
      const dy = pt.y - cur.points[n - 2];
      if (dx * dx + dy * dy < 0.35) return;
    }
    const next: Stroke = { ...cur, points: [...cur.points, pt.x, pt.y, pt.p] };
    liveRef.current = next;
    setLive(next);
  }, [brush.streamline]);

  /** Hit-test strokes for the eraser: within half a nib of any sample. */
  const strokesNear = useCallback((lx: number, ly: number, radius: number): string[] => {
    const hits: string[] = [];
    for (const s of strokes) {
      const r = radius + s.brush.size / 2;
      const r2 = r * r;
      const p = s.points;
      for (let i = 0; i + 2 < p.length; i += 3) {
        const dx = p[i] - lx, dy = p[i + 1] - ly;
        if (dx * dx + dy * dy <= r2) { hits.push(s.id); break; }
      }
    }
    return hits;
  }, [strokes]);

  // ---- move tool state ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragOffset, setDragOffset] = useState({ dCol: 0, dRow: 0 });
  const [isDraggingDots, setIsDraggingDots] = useState(false);
  const [rubberBand, setRubberBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const isDraggingDotsRef = useRef(false);
  const isRubberBandingRef = useRef(false);
  const dragOriginsRef = useRef<Map<string, { col: number; row: number }>>(new Map());
  const moveStartRef = useRef({ x: 0, y: 0 });
  const rubberBandStartRef = useRef({ x: 0, y: 0 });

  // Expanding a raw hit/marquee set to whole groups: selecting one dot of a
  // group selects every dot in it, so groups move and export as a unit.
  const expandToGroups = useCallback((ids: Set<string>): Set<string> => {
    const groups = new Set<string>();
    for (const d of dots) if (ids.has(d.id) && d.groupId) groups.add(d.groupId);
    if (groups.size === 0) return ids;
    const out = new Set(ids);
    for (const d of dots) if (d.groupId && groups.has(d.groupId)) out.add(d.id);
    return out;
  }, [dots]);

  useEffect(() => { expandToGroupsRef.current = expandToGroups; }, [expandToGroups]);

  useEffect(() => { onSelectionChange?.([...selectedIds]); }, [selectedIds, onSelectionChange]);

  // Clear move state when switching away from move tool
  useEffect(() => {
    if (tool !== 'move') {
      setSelectedIds(new Set());
      setRubberBand(null);
      setIsDraggingDots(false);
      setDragOffset({ dCol: 0, dRow: 0 });
      isDraggingDotsRef.current = false;
      isRubberBandingRef.current = false;
    }
  }, [tool]);

  // Escape clears selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedIds(new Set()); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- dots for gooey render ----
  // In move+drag: exclude selected dots (they render separately at offset)
  const gooeyDots = useMemo(() => {
    let base = dots.filter(d => !erasedIds.has(d.id));
    if (tool === 'move' && isDraggingDots) {
      base = base.filter(d => !selectedIds.has(d.id));
    }
    base = [...base, ...markDots];
    
    // Filter by layer visibility. The Artwork toggle must only hide artwork-layer
    // dots — it used to gate the entire <g>, so hiding Artwork blanked every
    // custom layer along with it.
    const visible = base.filter(d => {
      if (d.layerId) {
        const l = customLayers.find(x => x.id === d.layerId);
        if (l && !l.visible) return false;
        return true;
      }
      return artLayerVisible;
    });

    // Partition instead of sort to avoid call stack limits on huge arrays
    const customDots = [];
    const artDots = [];
    for (const d of visible) {
      if (d.layerId) customDots.push(d);
      else artDots.push(d);
    }
    return [...customDots, ...artDots];
  }, [dots, erasedIds, markDots, tool, isDraggingDots, selectedIds, customLayers, artLayerVisible]);

  // Selected dots at their display positions (original or offset during drag)
  const selectedDotsDisplay = useMemo(() => {
    if (tool !== 'move') return [];
    return dots.filter(d => selectedIds.has(d.id)).map(d =>
      isDraggingDots
        ? { ...d, col: d.col + dragOffset.dCol, row: d.row + dragOffset.dRow }
        : d
    );
  }, [dots, selectedIds, isDraggingDots, dragOffset, tool]);

  const animTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => () => { animTimers.current.forEach(clearTimeout); animTimers.current.clear(); }, []);

  const addAnim = useCallback((id: string) => {
    setAnimIds(p => new Set(p).add(id));
    const t = setTimeout(() => {
      animTimers.current.delete(t);
      setAnimIds(p => { const n = new Set(p); n.delete(id); return n; });
    }, 350);
    animTimers.current.add(t);
  }, []);

  // ---- coordinate helpers ----
  const getLogical = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - panRef.current.y) / zoomRef.current,
    };
  }, []);

  useEffect(() => { getLogicalRef.current = getLogical; }, [getLogical]);

  const screenToNode = useCallback((clientX: number, clientY: number) => {
    const { x, y } = getLogical(clientX, clientY);
    return { col: Math.floor(x / CELL), row: Math.floor(y / CELL) };
  }, [getLogical]);

  // Find the dot nearest to a logical point (within dotR)
  const findDotNear = useCallback((lx: number, ly: number): Dot | null => {
    let nearest: Dot | null = null;
    let minDist = Infinity;
    for (const dot of dots) {
      const cx = dot.col * CELL + CELL / 2;
      const cy = dot.row * CELL + CELL / 2;
      // Hit radius must follow the dot's own size — image-import dots are far
      // smaller than dotR, and a fixed radius made them grab-able from cells away.
      const hitR = (dot.sizeOverride ? CELL * dot.sizeOverride : dotR) * 1.1;
      const d = Math.sqrt((lx - cx) ** 2 + (ly - cy) ** 2);
      if (d <= hitR && d < minDist) { minDist = d; nearest = dot; }
    }
    return nearest;
  }, [dots, dotR]);

  // ---- pointer handlers ----
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Pan: middle-mouse, space+left, or hand tool
    if (e.button === 1 || (e.button === 0 && (spaceHeld || tool === 'hand'))) {
      isPanning.current = true;
      setPanActive(true);
      panAnchor.current = { clientX: e.clientX, clientY: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    // --- Freehand mode: pen draws strokes, eraser removes whole strokes ---
    if (mode === 'freehand' && (tool === 'pen' || tool === 'eraser')) {
      const { x, y } = getLogical(e.clientX, e.clientY);
      if (tool === 'eraser') {
        isFreehandDrawing.current = true;
        const hit = strokesNear(x, y, brush.size / 2);
        if (hit.length) onEraseStrokes(hit);
        return;
      }
      isFreehandDrawing.current = true;
      lastPtRef.current = null;
      const started: Stroke = {
        id: `s${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        points: [],
        color: dotColorRef.current,
        brush: { ...brush },
        layerId: activeLayerId ?? undefined,
      };
      liveRef.current = started;
      setLive(started);
      pushLivePoint(e.clientX, e.clientY, (e as unknown as PointerEvent).pressure);
      if ((window as any).dotletSynth) (window as any).dotletSynth.draw();
      return;
    }

    // --- Move tool ---
    if (tool === 'move') {
      const { x: lx, y: ly } = getLogical(e.clientX, e.clientY);
      const hit = findDotNear(lx, ly);

      if (hit) {
        // If the dot is already selected, drag all selected; otherwise select
        // just this one — expanded to its whole group if it belongs to one.
        // Shift-click adds to the existing selection.
        const base = selectedIds.has(hit.id)
          ? selectedIds
          : e.shiftKey
            ? new Set<string>([...selectedIds, hit.id])
            : new Set<string>([hit.id]);
        const newSelected = expandToGroups(base);
        setSelectedIds(newSelected);
        isDraggingDotsRef.current = true;
        setIsDraggingDots(true);
        dragOriginsRef.current = new Map(
          dots.filter(d => newSelected.has(d.id)).map(d => [d.id, { col: d.col, row: d.row }])
        );
        moveStartRef.current = { x: lx, y: ly };
        setDragOffset({ dCol: 0, dRow: 0 });
      } else {
        setSelectedIds(new Set());
        isRubberBandingRef.current = true;
        rubberBandStartRef.current = { x: lx, y: ly };
        setRubberBand({ x1: lx, y1: ly, x2: lx, y2: ly });
      }
      return;
    }

    // --- Pen / Eraser ---
    isDrawing.current = true;
    visitedNodes.current = new Set();

    const effectiveTool: Tool = tool === 'pen' && e.altKey ? 'eraser' : tool;
    strokeToolRef.current = effectiveTool;
    // Lock the colour and target layer for this entire stroke
    strokeColorRef.current = dotColorRef.current;
    strokeLayerRef.current = activeLayerId;

    const markId = nextMarkId.current++;
    const clusterId = clusterMode === 'blend' ? 0 : nextClusterId.current++;
    markIdRef.current = markId;
    clusterIdRef.current = clusterId;

    const { col, row } = screenToNode(e.clientX, e.clientY);
    visitedNodes.current.add(`${col},${row}`);

    if (effectiveTool === 'pen') {
      const occupied = dots.find(d => d.col === col && d.row === row);
      if (occupied) {
        isDrawing.current = false;
        onMarkComplete(dots.filter(d => d.id !== occupied.id));
        if ((window as any).dotletSynth) (window as any).dotletSynth.erase();
        return;
      }
      const dot: Dot = { id: `m${markId}-${col}-${row}`, col, row, shape: dotShape, clusterId, markId, ...layerStamp() };
      setMarkDots([dot]);
      addAnim(dot.id);
      if ((window as any).dotletSynth) (window as any).dotletSynth.draw();
    } else {
      const hit = dots.find(d => d.col === col && d.row === row);
      if (hit) {
        setErasedIds(p => new Set(p).add(hit.id));
        if ((window as any).dotletSynth) (window as any).dotletSynth.erase();
      }
    }
  }, [dots, tool, dotShape, clusterMode, spaceHeld, selectedIds, activeLayerId, layerStamp, expandToGroups, getLogical, findDotNear, screenToNode, nextMarkId, nextClusterId, onMarkComplete, addAnim,
      mode, brush, strokesNear, pushLivePoint, onEraseStrokes]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Pan
    if (isPanning.current) {
      const dx = e.clientX - panAnchor.current.clientX;
      const dy = e.clientY - panAnchor.current.clientY;
      setPan({ x: panAnchor.current.panX + dx, y: panAnchor.current.panY + dy });
      return;
    }

    // --- Freehand mode ---
    if (mode === 'freehand' && isFreehandDrawing.current) {
      if (tool === 'eraser') {
        const { x, y } = getLogical(e.clientX, e.clientY);
        const hit = strokesNear(x, y, brush.size / 2);
        if (hit.length) onEraseStrokes(hit);
        return;
      }
      pushLivePoint(e.clientX, e.clientY, (e as unknown as PointerEvent).pressure);
      return;
    }

    // --- Move tool ---
    if (tool === 'move') {
      const { x: lx, y: ly } = getLogical(e.clientX, e.clientY);

      if (isDraggingDotsRef.current) {
        const dx = lx - moveStartRef.current.x;
        const dy = ly - moveStartRef.current.y;
        setDragOffset({ dCol: Math.round(dx / CELL), dRow: Math.round(dy / CELL) });
      } else if (isRubberBandingRef.current) {
        const { x: sx, y: sy } = rubberBandStartRef.current;
        setRubberBand({ x1: sx, y1: sy, x2: lx, y2: ly });
        const minX = Math.min(sx, lx), maxX = Math.max(sx, lx);
        const minY = Math.min(sy, ly), maxY = Math.max(sy, ly);
        setSelectedIds(expandToGroups(new Set(
          dots.filter(d => {
            const cx = d.col * CELL + CELL / 2;
            const cy = d.row * CELL + CELL / 2;
            return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
          }).map(d => d.id)
        )));
      }
      return;
    }

    // --- Pen / Eraser ---
    if (!isDrawing.current) return;
    const effectiveTool: Tool = strokeToolRef.current === 'pen' && e.altKey ? 'eraser' : strokeToolRef.current;
    const { col, row } = screenToNode(e.clientX, e.clientY);
    const key = `${col},${row}`;
    if (visitedNodes.current.has(key)) return;
    visitedNodes.current.add(key);

    if (effectiveTool === 'pen') {
      if (dots.some(d => d.col === col && d.row === row)) return;
      const dot: Dot = { id: `m${markIdRef.current}-${col}-${row}`, col, row, shape: dotShape, clusterId: clusterIdRef.current, markId: markIdRef.current, ...layerStamp() };
      setMarkDots(p => [...p, dot]);
      addAnim(dot.id);
      if ((window as any).dotletSynth) (window as any).dotletSynth.draw();
    } else {
      setMarkDots(p => p.filter(d => !(d.col === col && d.row === row)));
      const hit = dots.find(d => d.col === col && d.row === row);
      if (hit) {
        setErasedIds(p => new Set(p).add(hit.id));
        if ((window as any).dotletSynth) (window as any).dotletSynth.erase();
      }
    }
  }, [dots, tool, dotShape, layerStamp, expandToGroups, screenToNode, getLogical, addAnim,
      mode, brush, strokesNear, pushLivePoint, onEraseStrokes]);

  const handlePointerUp = useCallback(() => {
    // Pan
    if (isPanning.current) { isPanning.current = false; setPanActive(false); return; }

    // --- Freehand: commit the live stroke as one history entry ---
    if (mode === 'freehand') {
      if (!isFreehandDrawing.current) return;
      isFreehandDrawing.current = false;
      const finished = liveRef.current;
      liveRef.current = null;
      lastPtRef.current = null;
      setLive(null);
      if (finished && finished.points.length >= 3) onStrokeComplete(finished);
      return;
    }

    // --- Move tool ---
    if (tool === 'move') {
      if (isDraggingDotsRef.current) {
        isDraggingDotsRef.current = false;
        setIsDraggingDots(false);

        const { dCol, dRow } = dragOffset;
        if (dCol !== 0 || dRow !== 0) {
          const origins = dragOriginsRef.current;
          const movedIds = new Set(origins.keys());
          let collision = false;
          const targets = new Set<string>();

          for (const [, origin] of origins) {
            const nc = origin.col + dCol;
            const nr = origin.row + dRow;
            const k = `${nc},${nr}`;
            if (targets.has(k)) { collision = true; break; }
            targets.add(k);
            if (dots.some(d => d.col === nc && d.row === nr && !movedIds.has(d.id))) { collision = true; break; }
          }

          if (!collision) {
            const newDots = dots.map(d => {
              const o = origins.get(d.id);
              return o ? { ...d, col: o.col + dCol, row: o.row + dRow } : d;
            });
            onMarkComplete(newDots);
            // Keep the moved dots selected at their new positions
            setSelectedIds(prev => new Set(prev)); // trigger re-render; IDs unchanged
          }
          // collision → snap back silently (no dot state change)
        }

        setDragOffset({ dCol: 0, dRow: 0 });
        dragOriginsRef.current = new Map();
      } else if (isRubberBandingRef.current) {
        isRubberBandingRef.current = false;
        setRubberBand(null);
      }
      return;
    }

    // --- Pen / Eraser ---
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const committed = dots.filter(d => !erasedIds.has(d.id));
    const final = markDots.length > 0 || erasedIds.size > 0 ? [...committed, ...markDots] : dots;
    setMarkDots([]);
    setErasedIds(new Set());
    onMarkComplete(final);
  }, [dots, tool, markDots, erasedIds, dragOffset, onMarkComplete, mode, onStrokeComplete]);

  // ---- cluster grouping for gooey dots ----
  const clusterIds = useMemo(() => Array.from(new Set(gooeyDots.map(d => d.clusterId))), [gooeyDots]);
  const byCluster = useMemo(() => {
    const m = new Map<number, Dot[]>();
    gooeyDots.forEach(d => { if (!m.has(d.clusterId)) m.set(d.clusterId, []); m.get(d.clusterId)!.push(d); });
    return m;
  }, [gooeyDots]);

  const getDotProps = (dot: Dot, extraClass?: string) => {
    const l = dot.layerId ? customLayers.find(x => x.id === dot.layerId) : null;
    const fill = dot.colorOverride || (l ? l.color : dotColor);
    const radius = dot.sizeOverride ? CELL * dot.sizeOverride : dotR;
    return {
      shape: dot.shape,
      cx: dot.col * CELL + CELL / 2,
      cy: dot.row * CELL + CELL / 2,
      r: radius,
      fill,
      className: extraClass ?? (animIds.has(dot.id) ? 'dot-enter' : undefined)
    };
  };

  // ---- bounding box for selected dots during drag ----
  const selBBox = useMemo(() => {
    // Shown for any multi-dot selection, not just while dragging — a group needs
    // a visible boundary to read as one object.
    if (selectedDotsDisplay.length < 2) return null;
    const cols = selectedDotsDisplay.map(d => d.col);
    const rows = selectedDotsDisplay.map(d => d.row);
    const minCol = cols.length > 0 ? cols.reduce((a, b) => Math.min(a, b)) : 0;
    const maxCol = cols.length > 0 ? cols.reduce((a, b) => Math.max(a, b)) : 0;
    const minRow = rows.length > 0 ? rows.reduce((a, b) => Math.min(a, b)) : 0;
    const maxRow = rows.length > 0 ? rows.reduce((a, b) => Math.max(a, b)) : 0;
    return {
      x: minCol * CELL,
      y: minRow * CELL,
      w: (maxCol - minCol + 1) * CELL,
      h: (maxRow - minRow + 1) * CELL,
    };
  }, [selectedDotsDisplay]);

  // ---- cursor ----
  const cursor = panActive ? 'grabbing'
    : (spaceHeld || tool === 'hand') ? 'grab'
    : tool === 'move' ? (isDraggingDots ? 'grabbing' : 'grab')
    : tool === 'eraser' ? 'cell'
    : 'crosshair';

  // ---- infinite grid via CSS background ----
  // Always emit all four longhands so React never adds/removes properties between renders,
  // which would trigger the shorthand/longhand conflict warning.
  const tileSize = CELL * zoom;
  const gridStyle: React.CSSProperties = {
    backgroundImage: showGrid
      ? 'radial-gradient(circle, rgba(61,94,245,0.15) 1px, transparent 1px)'
      : 'none',
    backgroundSize: `${tileSize}px ${tileSize}px`,
    backgroundPosition: `${pan.x + tileSize / 2}px ${pan.y + tileSize / 2}px`,
    backgroundRepeat: 'repeat',
  };

  const sw = (px: number) => px / zoom; // logical stroke-width for a given screen px

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative"
      style={{ backgroundColor: bgColor, cursor, ...gridStyle }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        style={{
          position: 'absolute', left: 0, top: 0,
          width: gridW, height: gridH,
          transformOrigin: '0 0',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          willChange: 'transform',
        }}
      >
        <svg
          width={gridW}
          height={gridH}
          style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
        >
          <defs>
            {clusterMode === 'blend' && <FilterDef id="cg-0" spread={spread} crispness={crispness} roughness={roughness} outlineMode={outlineMode} outlineWeight={outlineWeight} shadowOpacity={shadowOpacity} shadowBlur={shadowBlur} CELL={CELL} />}
            {clusterMode === 'separate' && clusterIds.map(cid => <FilterDef key={`cg-${cid}`} id={`cg-${cid}`} spread={spread} crispness={crispness} roughness={roughness} outlineMode={outlineMode} outlineWeight={outlineWeight} shadowOpacity={shadowOpacity} shadowBlur={shadowBlur} CELL={CELL} />)}
          </defs>

          {/* Freehand strokes. Plain geometry — no filters — so what's on
              screen is exactly what exports. */}
          {mode === 'freehand' && (
            <g>
              {strokes.map(s => {
                if (s.layerId) {
                  const l = customLayers.find(x => x.id === s.layerId);
                  if (l && !l.visible) return null;
                } else if (!artLayerVisible) return null;
                return <StrokeShape key={s.id} stroke={s} />;
              })}
              {live && <StrokeShape stroke={live} />}
            </g>
          )}

          {/* Gooey dots (non-selected during move drag) — per-layer visibility
              is already applied in gooeyDots. */}
          {mode === 'dots' && gooeyDots.length > 0 && (
            <g>
              {clusterMode === 'blend' ? (
                <g filter="url(#cg-0)">{gooeyDots.map(d => renderDotElement({ key: d.id, ...getDotProps(d) }))}</g>
              ) : (
                clusterIds.map(cid => (
                  <g key={cid} filter={`url(#cg-${cid})`}>
                    {(byCluster.get(cid) || []).map(d => renderDotElement({ key: d.id, ...getDotProps(d) }))}
                  </g>
                ))
              )}
            </g>
          )}

          {/* Selected dots overlay (outside filter — unmerged, crisp during drag) */}
          {mode === 'dots' && tool === 'move' && selectedDotsDisplay.map(dot => {
            const cx = dot.col * CELL + CELL / 2;
            const cy = dot.row * CELL + CELL / 2;
            return (
              <g key={`sel-${dot.id}`}>
                {renderDotElement(getDotProps(dot))}
                <circle
                  cx={cx} cy={cy} r={dotR + sw(4)}
                  stroke={dotColor} strokeWidth={sw(1.5)}
                  fill="none" opacity={0.6}
                />
              </g>
            );
          })}

          {/* Bounding box while dragging */}
          {selBBox && (
            <rect
              x={selBBox.x} y={selBBox.y}
              width={selBBox.w} height={selBBox.h}
              fill="none"
              stroke={dotColor} strokeWidth={sw(1)}
              strokeDasharray={`${sw(6)} ${sw(4)}`}
              opacity={0.4}
            />
          )}

          {/* Rubber-band selection rect */}
          {tool === 'move' && rubberBand && (
            <rect
              x={Math.min(rubberBand.x1, rubberBand.x2)}
              y={Math.min(rubberBand.y1, rubberBand.y2)}
              width={Math.abs(rubberBand.x2 - rubberBand.x1)}
              height={Math.abs(rubberBand.y2 - rubberBand.y1)}
              fill={`${dotColor}18`}
              stroke={dotColor} strokeWidth={sw(1)}
              strokeDasharray={`${sw(5)} ${sw(3)}`}
            />
          )}
        </svg>
      </div>
    </div>
  );
});
