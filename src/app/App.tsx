import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Canvas, type CanvasHandle } from './components/Canvas';
import { FloatingPalette } from './components/FloatingPalette';
import { RightSidebar } from './components/RightSidebar';
import { ShapeFloater } from './components/ShapeFloater';
import { TopHeader } from './components/TopHeader';
import { FileManager, SaveButton, type SaveStatus, type DotletFile, type CanvasState } from './components/FileManager';
import { getDotSVGString } from './components/dotShapes';
import type {
  Dot, Tool, DotShape, ClusterMode, GridSize, CanvasLayer,
  CanvasMode, Stroke, BrushSettings, BrushType,
} from './types';
import { alphaToPathData } from './lib/trace';
import { BRUSH_PRESETS } from './lib/stroke';
import { ProductTour, TourWelcomeModal, type TourStep } from './components/ProductTour';
import { HelpCircle, Pin, PinOff } from 'lucide-react'; // pin panel toggle

const MAX_HISTORY = 50;

const TOUR_STEPS: TourStep[] = [
  {
    target: '#tour-anchor-toggle',
    title: 'Pin Panel',
    content: 'Click "Unpin" to dismiss this settings panel and get a full-canvas view. A "Pin Panel" button appears on the right edge to bring it back. Your tools are always one tap away.',
    placement: 'left',
    spotlightShape: 'rect',
  },
  {
    target: '#tour-tools',
    title: 'Drawing Tools',
    content: 'Pick your active tool: Pen places dots, Eraser removes them, Select (arrow) clicks or drags a marquee to pick dots — then group them with Cmd+G or export just that selection — and Hand pans the view. Shortcuts: P, E, V, H.',
    placement: 'top',
    spotlightShape: 'rect',
  },
  {
    target: '#tour-shape-fab',
    title: 'Shape & Color',
    content: 'Click to open the shape palette. Choose from 8 dot shapes — circle, star, hexagon, crescent and more — and pick your dot and background colors. The active shape previews on the button.',
    placement: 'right',
    spotlightShape: 'circle',
  },
  {
    target: '#tour-undo-redo',
    title: 'Undo & Redo',
    content: 'Revert or replay any stroke. History stacks up to 50 steps deep. Keyboard shortcuts: Cmd+Z to undo, Cmd+Shift+Z to redo.',
    placement: 'top',
    spotlightShape: 'rect',
  },
  {
    target: '#tour-export',
    title: 'Export Your Art',
    content: 'Download as SVG (Inkscape & Illustrator-ready), PNG at 3× resolution, or a Figma-safe SVG with the gooey merge baked in as a raster. You can also copy PNG straight to clipboard.',
    placement: 'top',
    spotlightShape: 'rect',
  },
  {
    target: '#tour-composer',
    title: 'Text Composer',
    content: 'Type labels, titles, or multi-line annotations here. Text is anchored to the current canvas view and stays with your artwork. Great for adding context or composing layered dot-art lettering.',
    placement: 'top',
    spotlightShape: 'rect',
  },
  {
    target: '#tour-image-to-shape',
    title: 'Image to Shape',
    content: 'Upload any image and Dotlet converts its pixels into a grid of colored dots. "Colored" mode gives full-color pixel art; "Outline" traces just the silhouette edges into dots.',
    placement: 'left',
    spotlightShape: 'rect',
  },
  {
    target: '#tour-layers',
    title: 'Layers',
    content: 'Organize artwork across layers. Artwork always renders on top, Background at the bottom. Add custom color layers in between for complex multi-color compositions. Double-click a layer name to rename it.',
    placement: 'left',
    spotlightShape: 'rect',
  },
  {
    target: '#tour-effects',
    title: 'Effects',
    content: 'Dial in the organic merge: Smoothness blends nearby dots together, Sharpness crisps the edges, Roughness adds a hand-drawn wobble. Enable Outline Mode for bold silhouette strokes.',
    placement: 'left',
    spotlightShape: 'rect',
  },
  {
    target: '#tour-grid',
    title: 'Grid Settings',
    content: 'Set canvas resolution from 8 to 48 dots per side. Smaller grids give chunky pixel art; larger grids allow fine detail. Toggle the grid overlay to show or hide cell lines while drawing.',
    placement: 'left',
    spotlightShape: 'rect',
  },
];

export const synth = {
  ctx: null as AudioContext | null,
  muted: false,

  init() {
    if (!this.ctx) {
      const C = window.AudioContext || (window as any).webkitAudioContext;
      if (C) this.ctx = new C();
    }
  },

  // Pink-noise approximation (Paul Kellet) for organic pencil texture
  _noise(duration: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const sr = this.ctx.sampleRate;
    const len = Math.ceil(sr * duration);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      d[i] = (b0 + b1 + b2 + w * 0.5362) * 0.13;
    }
    return buf;
  },

  // Pencil-on-paper scratch — short pink-noise burst bandpassed around graphite freq
  draw() {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    
    // Oscillator
    const osc = ctx.createOscillator();
    osc.frequency.value = 600; // Warm, gentle Hz
    osc.type = 'sine';
    
    // Gain (volume control)
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.04, now); // Start volume (reduced)
    gain.gain.linearRampToValueAtTime(0, now + 0.05); // Fade out over 50ms
    
    // Connect & play
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  },

  // Cute eraser — airy squeak (rising sine) + soft low-passed friction noise
  erase() {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680 + Math.random() * 180, t);
    osc.frequency.linearRampToValueAtTime(920 + Math.random() * 120, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.052, t + 0.007);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(og); og.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.07);
    const buf = this._noise(0.055);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 1400;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.035, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
      src.connect(lpf); lpf.connect(ng); ng.connect(ctx.destination);
      src.start(t); src.stop(t + 0.055);
    }
  },

  // Calm C-E-G chime arpeggio with second-harmonic shimmer
  save() {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    ([[523.25, 0], [659.25, 0.11], [783.99, 0.22]] as [number, number][]).forEach(([freq, delay]) => {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.088, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine'; osc2.frequency.value = freq * 2;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(0.018, t + 0.012);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(g); g.connect(ctx.destination);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.9);
      osc2.start(t); osc2.stop(t + 0.5);
    });
  },

  // Soft descending click for UI buttons
  click() {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.035);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.036, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.035);
  },

  // Rising triangle arpeggio for image generation
  generate() {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    ([261.63, 329.63, 392.00, 523.25] as number[]).forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.075;
      const osc = ctx.createOscillator();
      osc.type = 'triangle'; osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.068, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.3);
    });
  },
};
(window as any).dotletSynth = synth;

// ---- SVG export builder ----

/**
 * @param useClass  true  → dots rendered with class="dot" + CSS block (SVG export)
 *                  false → dots rendered with inline fill attr (PNG raster via canvas)
 */
// Single export pipeline — always mirrors the live canvas exactly.
// No crisp/gooey branch: the filter is always written using current slider values.
// At spread=0 the blur is zero and the filter has no visual effect automatically.
function buildExportSVG(
  dots: Dot[],
  dotColor: string,
  bgColor: string,
  bgLayerVisible: boolean,
  artLayerVisible: boolean,
  gridSize: number,
  clusterMode: ClusterMode,
  spread: number,
  crispness: number,
  outlineMode: boolean,
  outlineWeight: number,
  customLayers: CanvasLayer[],
  roughness: number,
  shadowOpacity: number,
  shadowBlur: number,
  cropToContent = false,
  /** Force an exact viewBox. Needed when tracing: every colour pass must
      rasterise into the same frame or the traced paths won't line up. */
  bboxOverride?: { minCol: number; maxCol: number; minRow: number; maxRow: number },
) {
  const CELL = 60; // must match Canvas.tsx
  const dotR = CELL * 0.56;
  const ts = new Date().toISOString();

  const stdDev = Math.pow(spread / 100, 1.8) * CELL;
  const matrix = `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${crispness * 2} ${-crispness}`;

  // Mirrors <FilterDef> in Canvas.tsx — roughness and shadow used to be dropped
  // here, so exports silently ignored those two sliders.
  const roughFreq = roughness > 0 ? (roughness / 100) * 0.06 : 0;
  const roughScale = roughness > 0 ? (roughness / 100) * CELL * 0.4 : 0;
  const shadowA = shadowOpacity / 100;

  const roughStage = (input: string, result: string) => roughness > 0
    ? `<feTurbulence type="fractalNoise" baseFrequency="${roughFreq.toFixed(5)}" numOctaves="3" seed="2" result="noise"/>
      <feDisplacementMap in="${input}" in2="noise" scale="${roughScale.toFixed(3)}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`
    : '';

  const makeFilter = (id: string) => {
    const stages: string[] = [
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${stdDev.toFixed(3)}" result="blur"/>`,
      `<feColorMatrix in="blur" mode="matrix" values="${matrix}" result="thresh"/>`,
    ];
    let last = 'thresh';
    if (outlineMode) {
      if (roughness > 0) { stages.push(roughStage('thresh', 'rough')); last = 'rough'; }
      stages.push(`<feMorphology in="${last}" operator="dilate" radius="${outlineWeight}" result="dilated"/>`);
      stages.push(`<feComposite in="dilated" in2="${last}" operator="xor" result="shape"/>`);
      last = 'shape';
    } else if (roughness > 0) {
      stages.push(roughStage('thresh', 'shape'));
      last = 'shape';
    }
    if (shadowA > 0) {
      stages.push(`<feGaussianBlur in="${last}" stdDeviation="${(shadowBlur * 0.5).toFixed(3)}" result="shadowBlur"/>`);
      stages.push(`<feColorMatrix in="shadowBlur" mode="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${shadowA * 3} 0" result="shadow"/>`);
      stages.push(`<feMerge><feMergeNode in="shadow"/><feMergeNode in="${last}"/></feMerge>`);
    }
    const box = shadowA > 0
      ? 'x="-60%" y="-60%" width="220%" height="220%"'
      : 'x="-50%" y="-50%" width="200%" height="200%"';
    return `<filter id="${id}" ${box} color-interpolation-filters="sRGB">
      ${stages.join('\n      ')}
    </filter>`;
  };

  // Mirrors gooeyDots in Canvas.tsx: the Artwork toggle hides only artwork-layer
  // dots, custom layers are governed by their own visibility flag.
  const visible = dots.filter(d => {
    if (d.layerId) {
      const l = customLayers.find(x => x.id === d.layerId);
      if (l && !l.visible) return false;
      return true;
    }
    return artLayerVisible;
  });

  const customDots = [];
  const artDots = [];
  for (const d of visible) {
    if (d.layerId) customDots.push(d);
    else artDots.push(d);
  }
  const visibleDots = [...customDots, ...artDots];

  // cropToContent: bound the viewBox to the dots alone, ignoring the grid box.
  // Used when exporting a selection, so a single object doesn't come out padded
  // with the whole empty canvas around it.
  let minCol = 0, maxCol = gridSize - 1;
  let minRow = 0, maxRow = gridSize - 1;
  if (visibleDots.length > 0) {
    const cols = visibleDots.map(d => d.col);
    const rows = visibleDots.map(d => d.row);
    if (cropToContent) {
      minCol = Math.min(...cols); maxCol = Math.max(...cols);
      minRow = Math.min(...rows); maxRow = Math.max(...rows);
    } else {
      minCol = Math.min(0, ...cols);
      maxCol = Math.max(gridSize - 1, ...cols);
      minRow = Math.min(0, ...rows);
      maxRow = Math.max(gridSize - 1, ...rows);
    }
  }
  if (bboxOverride) {
    ({ minCol, maxCol, minRow, maxRow } = bboxOverride);
  }
  minCol -= 1; maxCol += 1;
  minRow -= 1; maxRow += 1;
  const W = (maxCol - minCol + 1) * CELL;
  const H = (maxRow - minRow + 1) * CELL;
  const minX = minCol * CELL;
  const minY = minRow * CELL;

  const clusterIds = Array.from(new Set(visibleDots.map(d => d.clusterId)));
  const byCluster = new Map<number, Dot[]>();
  visibleDots.forEach(d => {
    if (!byCluster.has(d.clusterId)) byCluster.set(d.clusterId, []);
    byCluster.get(d.clusterId)!.push(d);
  });

  const dotLine = (dot: Dot) => {
    const l = dot.layerId ? customLayers.find(x => x.id === dot.layerId) : null;
    const fill = dot.colorOverride || (l ? l.color : dotColor);
    const radius = dot.sizeOverride ? CELL * dot.sizeOverride : dotR;
    return `        ${getDotSVGString(dot.shape, dot.col * CELL + CELL / 2, dot.row * CELL + CELL / 2, radius, false, fill)}`;
  };

  // Always write the defs/filter block — one code path for all exports.
  let defsBlock = '';
  if (visibleDots.length > 0) {
    if (clusterMode === 'blend') {
      defsBlock = `  <defs>\n    ${makeFilter('dotlet-filter-0')}\n  </defs>`;
    } else {
      const filters = clusterIds.map(cid => `    ${makeFilter(`dotlet-filter-${cid}`)}`).join('\n');
      defsBlock = `  <defs>\n${filters}\n  </defs>`;
    }
  }

  let artworkContent = '';
  if (visibleDots.length > 0) {
    if (clusterMode === 'blend') {
      artworkContent = `    <g id="cluster-0" inkscape:groupmode="layer" inkscape:label="Blended Cluster" filter="url(#dotlet-filter-0)">\n${visibleDots.map(dotLine).join('\n')}\n    </g>`;
    } else {
      artworkContent = clusterIds.map(cid => {
        const clusterDots = byCluster.get(cid) || [];
        return `    <g id="cluster-${cid}" inkscape:groupmode="layer" inkscape:label="Mark ${cid}" filter="url(#dotlet-filter-${cid})">\n${clusterDots.map(dotLine).join('\n')}\n    </g>`;
      }).join('\n');
    }
  }

  const svgStr = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by Dotlet ${ts} -->
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"
  viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}"
  enable-background="new ${minX} ${minY} ${W} ${H}"
>
${defsBlock ? defsBlock + '\n' : ''}${bgLayerVisible ? `  <g id="layer-background" inkscape:groupmode="layer" inkscape:label="Background">
    <rect fill="${bgColor}" x="${minX}" y="${minY}" width="${W}" height="${H}"/>
  </g>` : ''}
${visibleDots.length > 0 ? `  <g id="layer-artwork" inkscape:groupmode="layer" inkscape:label="Artwork">
${artworkContent}
  </g>` : ''}
</svg>`;
  return { svgStr, width: W, height: H, minX, minY };
}

// ---- history helpers ----

interface History { stack: Dot[][]; index: number }

function useHistory() {
  const ref = useRef<History>({ stack: [[]], index: 0 });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const sync = () => {
    setCanUndo(ref.current.index > 0);
    setCanRedo(ref.current.index < ref.current.stack.length - 1);
  };

  const push = useCallback((dots: Dot[]) => {
    const { stack, index } = ref.current;
    const newStack = [...stack.slice(0, index + 1), dots].slice(-MAX_HISTORY);
    ref.current = { stack: newStack, index: newStack.length - 1 };
    sync();
  }, []);

  const undo = useCallback((setDots: (d: Dot[]) => void) => {
    if (ref.current.index <= 0) return;
    ref.current.index--;
    setDots(ref.current.stack[ref.current.index]);
    sync();
  }, []);

  const redo = useCallback((setDots: (d: Dot[]) => void) => {
    if (ref.current.index >= ref.current.stack.length - 1) return;
    ref.current.index++;
    setDots(ref.current.stack[ref.current.index]);
    sync();
  }, []);

  return { push, undo, redo, canUndo, canRedo };
}

// ---- app ----

export default function App() {
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [sidebarAnchored, setSidebarAnchored] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('dotlet_sound') !== '0'; } catch { return true; }
  });

  useEffect(() => {
    synth.muted = !soundEnabled;
    try { localStorage.setItem('dotlet_sound', soundEnabled ? '1' : '0'); } catch {}
  }, [soundEnabled]);
  // ── File state ────────────────────────────────────────────────────────────
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('Untitled');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef('');
  const [dots, setDots] = useState<Dot[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [dotShape, setDotShape] = useState<DotShape>('rectangle');
  const [spread, setSpread] = useState(40);
  const [crispness, setCrispness] = useState(15);
  const [outlineMode, setOutlineMode] = useState(false);
  const [outlineWeight, setOutlineWeight] = useState(3);
  const [clusterMode, setClusterMode] = useState<ClusterMode>('blend');
  const [dotColor, setDotColor] = useState('#3d5ef5');
  const [bgColor, setBgColor] = useState('#fffef0');
  const [recentColors, setRecentColors] = useState<string[]>([]);
  // Sliders live in a popover by default; docking is a per-picker preference
  // that persists, since it's a workspace choice rather than document state.
  const [dockedPickers, setDockedPickers] = useState<{ shape: boolean; background: boolean }>(() => {
    try {
      const raw = localStorage.getItem('dotlet_docked_pickers');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { shape: false, background: false };
  });
  const handleToggleDock = useCallback((which: 'shape' | 'background') => {
    setDockedPickers(prev => {
      const next = { ...prev, [which]: !prev[which] };
      try { localStorage.setItem('dotlet_docked_pickers', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const [gridSize, setGridSize] = useState<GridSize>(24);
  const [showGrid, setShowGrid] = useState(true);
  const [bgLayerVisible, setBgLayerVisible] = useState(true);
  const [artLayerVisible, setArtLayerVisible] = useState(true);
  // Custom layers
  const [customLayers, setCustomLayers] = useState<CanvasLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  // Additional effects
  const [roughness, setRoughness] = useState(0);
  const [shadowOpacity, setShadowOpacity] = useState(0);
  const [shadowBlur, setShadowBlur] = useState(8);


  // ── Canvas mode & freehand ────────────────────────────────────────────────
  const [mode, setMode] = useState<CanvasMode>('dots');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brush, setBrush] = useState<BrushSettings>(BRUSH_PRESETS.pen);
  const strokeHistory = useRef<{ stack: Stroke[][]; index: number }>({ stack: [[]], index: 0 });

  const pushStrokes = useCallback((next: Stroke[]) => {
    const { stack, index } = strokeHistory.current;
    const newStack = [...stack.slice(0, index + 1), next].slice(-MAX_HISTORY);
    strokeHistory.current = { stack: newStack, index: newStack.length - 1 };
    setStrokes(next);
  }, []);

  const handleStrokeComplete = useCallback((s: Stroke) => {
    pushStrokes([...strokes, s]);
  }, [strokes, pushStrokes]);

  const handleEraseStrokes = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    pushStrokes(strokes.filter(s => !gone.has(s.id)));
  }, [strokes, pushStrokes]);

  const setBrushType = useCallback((t: BrushType) => {
    // Keep the user's size/opacity when switching, but adopt the preset's
    // character (streamline, grain, nib angle).
    setBrush(prev => ({ ...BRUSH_PRESETS[t], size: prev.size, opacity: BRUSH_PRESETS[t].opacity }));
  }, []);

  const [zoom, setZoom] = useState(1);
  const history = useHistory();
  const canvasRef = useRef<CanvasHandle>(null);
  const nextMarkId = useRef(1);
  const nextClusterId = useRef(1);

  const handleMarkComplete = useCallback((finalDots: Dot[]) => {
    setDots(finalDots);
    history.push(finalDots);
  }, [history.push]);

  // ── Selection & grouping ──────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const handleSelectionChange = useCallback((ids: string[]) => setSelectedIds(ids), []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedDots = useMemo(() => dots.filter(d => selectedSet.has(d.id)), [dots, selectedSet]);

  /** True when every selected dot already shares one group. */
  const selectionIsGrouped = useMemo(() => {
    if (selectedDots.length === 0) return false;
    const g = selectedDots[0].groupId;
    return !!g && selectedDots.every(d => d.groupId === g);
  }, [selectedDots]);

  const handleGroup = useCallback(() => {
    if (selectedIds.length < 2) return;
    const gid = crypto.randomUUID();
    const next = dots.map(d => selectedSet.has(d.id) ? { ...d, groupId: gid } : d);
    setDots(next);
    history.push(next);
  }, [dots, selectedIds.length, selectedSet, history.push]);

  const handleUngroup = useCallback(() => {
    if (selectedIds.length === 0) return;
    const next = dots.map(d => {
      if (!selectedSet.has(d.id) || !d.groupId) return d;
      const { groupId, ...rest } = d;
      return rest as Dot;
    });
    setDots(next);
    history.push(next);
  }, [dots, selectedIds.length, selectedSet, history.push]);

  // Undo/redo and Clear act on whichever document type is active — the two
  // modes keep separate history stacks so switching modes never loses work.
  const [strokeCanUndo, setStrokeCanUndo] = useState(false);
  const [strokeCanRedo, setStrokeCanRedo] = useState(false);
  const syncStrokeHistory = useCallback(() => {
    const { stack, index } = strokeHistory.current;
    setStrokeCanUndo(index > 0);
    setStrokeCanRedo(index < stack.length - 1);
  }, []);
  useEffect(syncStrokeHistory, [strokes, syncStrokeHistory]);

  const handleUndo = useCallback(() => {
    if (mode === 'freehand') {
      const h = strokeHistory.current;
      if (h.index <= 0) return;
      h.index--;
      setStrokes(h.stack[h.index]);
      return;
    }
    history.undo(setDots);
  }, [mode, history.undo]);

  const handleRedo = useCallback(() => {
    if (mode === 'freehand') {
      const h = strokeHistory.current;
      if (h.index >= h.stack.length - 1) return;
      h.index++;
      setStrokes(h.stack[h.index]);
      return;
    }
    history.redo(setDots);
  }, [mode, history.redo]);

  const handleClear = useCallback(() => {
    if (mode === 'freehand') { pushStrokes([]); return; }
    setDots([]);
    history.push([]);
  }, [mode, pushStrokes, history.push]);

  const addRecentColor = useCallback((c: string) => {
    setRecentColors(prev => [c, ...prev.filter(x => x !== c)].slice(0, 8));
  }, []);

  const handleSetGridSize = useCallback((newSize: GridSize) => {
    // Grid size is a guide/viewport setting, not a transform of the artwork.
    // The pen deliberately draws outside the grid box, so the old behaviour —
    // clamp every dot into 0..newSize-1, then de-dupe by cell — silently
    // destroyed everything drawn outside it (a whole stroke collapsing into a
    // couple of border dots). Dots keep their coordinates; only the overlay
    // and the zoom-to-fit extent change.
    setGridSize(newSize);
  }, []);

  // ── Save / load ───────────────────────────────────────────────────────────
  const getCanvas = useCallback((): CanvasState => ({
    dots: dots as unknown[], gridSize, dotColor, bgColor,
    spread, crispness, outlineMode, outlineWeight, clusterMode,
    // Custom layers and the remaining effect settings must round-trip too —
    // without them a saved file reloads with its layers (and every dot's layer
    // colour) gone.
    customLayers: customLayers as unknown[],
    roughness, shadowOpacity, shadowBlur, showGrid, dotShape,
  }), [dots, gridSize, dotColor, bgColor, spread, crispness, outlineMode, outlineWeight, clusterMode,
       customLayers, roughness, shadowOpacity, shadowBlur, showGrid, dotShape]);

  const saveFile = useCallback(async (fid: string, state: CanvasState, name: string) => {
    setSaveStatus('saving');
    try {
      const stored = localStorage.getItem('dotlet_files');
      let files: DotletFile[] = stored ? JSON.parse(stored) : [];
      const existingIdx = files.findIndex(f => f.id === fid);

      const newFile: DotletFile = {
        id: fid,
        // The header field is the source of truth for the open file's name.
        name,
        updatedAt: new Date().toISOString(),
        canvas: state
      };

      if (existingIdx >= 0) {
        files[existingIdx] = newFile;
      } else {
        files.push(newFile);
      }
      
      localStorage.setItem('dotlet_files', JSON.stringify(files));
      lastSavedRef.current = JSON.stringify(state);
      setSaveStatus('saved');
    } catch { setSaveStatus('unsaved'); }
  }, []);

  const handleSaveNow = useCallback(async () => {
    const fid = currentFileId ?? crypto.randomUUID();
    if (!currentFileId) setCurrentFileId(fid);
    await saveFile(fid, getCanvas(), fileName);
    synth.save();
  }, [currentFileId, saveFile, getCanvas, fileName]);

  // Renaming writes straight through, so the name is never lost to a reload.
  const handleRenameFile = useCallback((name: string) => {
    setFileName(name);
    if (currentFileId) saveFile(currentFileId, getCanvas(), name);
  }, [currentFileId, saveFile, getCanvas]);

  const handleNewFile = useCallback(() => {
    setCurrentFileId(crypto.randomUUID());
    setFileName('Untitled');
    setDots([]); setGridSize(24); setDotColor('#3d5ef5'); setBgColor('#fffef0');
    setSpread(40); setCrispness(15); setOutlineMode(false); setOutlineWeight(3); setClusterMode('blend');
    setCustomLayers([]); setActiveLayerId(null);
    setRoughness(0); setShadowOpacity(0); setShadowBlur(8);
    setBgLayerVisible(true); setArtLayerVisible(true);
    setSaveStatus('idle'); lastSavedRef.current = ''; history.push([]);
  }, [history.push]);

  const handleLoadFile = useCallback((file: DotletFile) => {
    if (!file.canvas) return;
    const c = file.canvas;
    const loadedDots = (c.dots ?? []) as Dot[];
    setCurrentFileId(file.id); setFileName(file.name || 'Untitled'); setDots(loadedDots);
    setGridSize(c.gridSize as GridSize); setDotColor(c.dotColor); setBgColor(c.bgColor);
    setSpread(c.spread); setCrispness(c.crispness); setOutlineMode(c.outlineMode);
    setOutlineWeight(c.outlineWeight); setClusterMode(c.clusterMode as ClusterMode);
    const layers = (c.customLayers ?? []) as CanvasLayer[];
    setCustomLayers(layers);
    setActiveLayerId(null);
    setRoughness(c.roughness ?? 0);
    setShadowOpacity(c.shadowOpacity ?? 0);
    setShadowBlur(c.shadowBlur ?? 8);
    if (c.showGrid !== undefined) setShowGrid(c.showGrid);
    if (c.dotShape) setDotShape(c.dotShape as DotShape);
    // Keep the id counters ahead of anything in the loaded file, otherwise new
    // strokes reuse mark/cluster ids and get merged into existing clusters.
    nextMarkId.current = loadedDots.reduce((m, d) => Math.max(m, d.markId ?? 0), 0) + 1;
    nextClusterId.current = loadedDots.reduce((m, d) => Math.max(m, d.clusterId ?? 0), 0) + 1;
    lastSavedRef.current = JSON.stringify(c); setSaveStatus('saved'); history.push(loadedDots);
  }, [history.push]);

  // Autosave — debounced 30 s after any canvas change
  useEffect(() => {
    if (!currentFileId) return;
    const cur = JSON.stringify(getCanvas());
    if (cur === lastSavedRef.current) return;
    setSaveStatus('unsaved');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => saveFile(currentFileId, getCanvas(), fileName), 30000);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dots, gridSize, dotColor, bgColor, spread, crispness, outlineMode, outlineWeight, clusterMode,
      customLayers, roughness, shadowOpacity, shadowBlur, showGrid, dotShape]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); handleRedo(); return; }
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); handleUndo(); return; }
      if (meta && e.key === '0') { e.preventDefault(); canvasRef.current?.zoomToFit(); return; }
      if (meta && e.key === '1') { e.preventDefault(); canvasRef.current?.zoomTo100(); return; }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); handleSaveNow(); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); handleUngroup(); return; }
      if (meta && e.key.toLowerCase() === 'g') { e.preventDefault(); handleGroup(); return; }
      if (meta) return; // don't steal other Cmd combos
      switch (e.key.toLowerCase()) {
        case 'h': setTool('hand'); break;
        case 'v': setTool('move'); break;
        case 'p': setTool('pen'); break;
        case 'e': setTool('eraser'); break;

        case '1': setDotShape('circle'); break;
        case '2': setDotShape('rectangle'); break;
        case '3': setDotShape('diamond'); break;
        case '4': setDotShape('teardrop'); break;
        case '5': setDotShape('star4'); break;
        case '6': setDotShape('cross'); break;
        case '7': setDotShape('hexagon'); break;
        case '8': setDotShape('crescent'); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo, handleSaveNow, handleGroup, handleUngroup]);

  // Global sound interaction
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      synth.init();
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('[role="button"]') || target.closest('input[type="range"]') || target.closest('[role="radio"]')) {
        synth.click();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, []);

  // Export helpers
  const ts = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const suffix = () => (outlineMode ? '-outline' : '');

  // One SVG builder — always mirrors live canvas state. useClass=true for SVG file
  // (editable CSS), false for PNG raster (inline fill, no stylesheet needed).
  // subset: export only these dots, cropped tight to them (selection export).
  const buildSVG = (forceTransparent?: boolean, subset?: Dot[]) =>
    buildExportSVG(subset ?? dots, dotColor, bgColor, forceTransparent ? false : bgLayerVisible, artLayerVisible,
      gridSize, clusterMode, spread, crispness, outlineMode, outlineWeight, customLayers,
      roughness, shadowOpacity, shadowBlur, !!subset);

  // Anchor must be in the document and the object URL must outlive the click —
  // revoking synchronously aborts the download in Firefox and Safari.
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  };

  /** Rasterise an SVG string via an <img>, resolving once decoded. */
  const loadSVG = (svgStr: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });

  const renderToCanvas = useCallback((forceTransparent?: boolean, subset?: Dot[]): Promise<HTMLCanvasElement> =>
    new Promise((resolve, reject) => {
      const { svgStr, width, height } = buildSVG(forceTransparent, subset);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const scale = 3;
        const c = document.createElement('canvas');
        c.width = width * scale; c.height = height * scale;
        const ctx = c.getContext('2d')!;
        if (!forceTransparent && bgLayerVisible) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
      img.src = url;
    }), [dots, dotColor, bgColor, bgLayerVisible, artLayerVisible, gridSize, clusterMode, spread, crispness, outlineMode, outlineWeight, roughness, shadowOpacity, shadowBlur, customLayers]);

  // `transparent` drops the background rect — the "Alpha SVG" button passes true.
  const handleExportSVG = useCallback((transparent?: boolean) => {
    // useClass=false (inline fill) so the SVG filter has concrete pixel data to process.
    // CSS-class fill is not reliably resolved by SVG filter pipelines in Illustrator/Inkscape.
    const { svgStr } = buildSVG(transparent);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    downloadBlob(blob, `dotlet-${ts()}${suffix()}${transparent ? '-alpha' : ''}.svg`);
  }, [dots, dotColor, bgColor, bgLayerVisible, artLayerVisible, gridSize, clusterMode, spread, crispness, outlineMode, outlineWeight, roughness, shadowOpacity, shadowBlur, customLayers]);

  const handleExportPNG = useCallback(async (transparent?: boolean) => {
    const c = await renderToCanvas(transparent);
    c.toBlob(blob => {
      if (!blob) return;
      downloadBlob(blob, `dotlet-${ts()}${suffix()}${transparent ? '-alpha' : ''}.png`);
    }, 'image/png');
  }, [renderToCanvas, outlineMode]);

  // Figma-safe SVG: gooey effect rasterised to PNG then embedded as a base64 <image>.
  // Figma strips feColorMatrix from filters so a regular SVG never shows the merge.
  // This wraps the rendered pixels in an SVG shell — looks like SVG, works in Figma.
  const handleExportEmbeddedSVG = useCallback(async (transparent?: boolean) => {
    const { width: W, height: H, minX, minY } = buildSVG(transparent);
    const c = await renderToCanvas(transparent);
    const dataUrl = c.toDataURL('image/png');
    const svgStr = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by Dotlet ${ts()} — embedded raster, Figma-safe -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}">
  <image href="${dataUrl}" x="${minX}" y="${minY}" width="${W}" height="${H}" preserveAspectRatio="none"/>
</svg>`;
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    downloadBlob(blob, `dotlet-${ts()}-figma${transparent ? '-alpha' : ''}.svg`);
  }, [renderToCanvas, gridSize]);

  /**
   * Traced vector SVG — the gooey shape baked into real paths, no filter.
   *
   * Figma ignores feColorMatrix, so a filtered SVG renders there as a blur with
   * the sharpening step missing. Here the browser rasterises the filtered art
   * (it applies the filter correctly), and we trace the resulting alpha back
   * into outlines. The output needs no filter support, so it looks identical in
   * Figma, Illustrator, Inkscape and every browser.
   *
   * Traced per fill colour so multi-colour artwork keeps its colours; each
   * colour pass shares one viewBox so the paths align exactly.
   */
  const handleExportTracedSVG = useCallback(async (transparent?: boolean, subset?: Dot[]) => {
    const source = subset ?? dots;
    const shown = source.filter(d => {
      if (d.layerId) {
        const l = customLayers.find(x => x.id === d.layerId);
        if (l && !l.visible) return false;
        return true;
      }
      return artLayerVisible;
    });
    if (shown.length === 0) return;

    // One frame for every pass.
    const cols = shown.map(d => d.col), rows = shown.map(d => d.row);
    const bbox = subset
      ? { minCol: Math.min(...cols), maxCol: Math.max(...cols), minRow: Math.min(...rows), maxRow: Math.max(...rows) }
      : {
          minCol: Math.min(0, ...cols), maxCol: Math.max(gridSize - 1, ...cols),
          minRow: Math.min(0, ...rows), maxRow: Math.max(gridSize - 1, ...rows),
        };

    const colourOf = (d: Dot) => {
      const l = d.layerId ? customLayers.find(x => x.id === d.layerId) : null;
      return d.colorOverride || (l ? l.color : dotColor);
    };
    const byColour = new Map<string, Dot[]>();
    for (const d of shown) {
      const c = colourOf(d);
      const list = byColour.get(c);
      if (list) list.push(d); else byColour.set(c, [d]);
    }

    const SAMPLES = 3; // raster samples per SVG unit
    let W = 0, H = 0, minX = 0, minY = 0;
    const paths: string[] = [];

    for (const [colour, group] of byColour) {
      const built = buildExportSVG(
        group, colour, bgColor, false, true, gridSize, clusterMode,
        spread, crispness, outlineMode, outlineWeight, customLayers,
        roughness, shadowOpacity, shadowBlur, false, bbox,
      );
      W = built.width; H = built.height; minX = built.minX; minY = built.minY;

      const img = await loadSVG(built.svgStr);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(W * SAMPLES));
      c.height = Math.max(1, Math.round(H * SAMPLES));
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, c.width, c.height);

      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const d = alphaToPathData(data, c.width, c.height, SAMPLES, minX, minY);
      if (d) paths.push(`  <path fill="${colour}" fill-rule="evenodd" d="${d}"/>`);
    }

    const bg = !transparent && bgLayerVisible
      ? `  <rect fill="${bgColor}" x="${minX}" y="${minY}" width="${W}" height="${H}"/>\n`
      : '';
    const svgStr = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by Dotlet ${ts()} — traced vector, no filters -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}">
${bg}${paths.join('\n')}
</svg>`;
    downloadBlob(new Blob([svgStr], { type: 'image/svg+xml' }),
      `dotlet-${ts()}${subset ? '-selection' : ''}-vector${transparent ? '-alpha' : ''}.svg`);
  }, [dots, dotColor, bgColor, bgLayerVisible, artLayerVisible, gridSize, clusterMode, spread,
      crispness, outlineMode, outlineWeight, customLayers, roughness, shadowOpacity, shadowBlur]);

  /**
   * Export just the current selection (a group, or any marquee selection),
   * cropped tight to it. Transparent by default — an isolated object is
   * normally wanted without the canvas background behind it.
   */
  const handleExportSelection = useCallback(async (format: 'svg' | 'png', transparent = true) => {
    if (selectedDots.length === 0) return;
    // Traced, so a selection dropped into Figma looks like it does on canvas.
    if (format === 'svg') { await handleExportTracedSVG(transparent, selectedDots); return; }
    const c = await renderToCanvas(transparent, selectedDots);
    c.toBlob(blob => { if (blob) downloadBlob(blob, `dotlet-selection-${ts()}.png`); }, 'image/png');
  }, [selectedDots, renderToCanvas, handleExportTracedSVG]);

  const handleCopyPNG = useCallback(async (transparent?: boolean) => {
    const c = await renderToCanvas(transparent);
    c.toBlob(async blob => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } catch {
        downloadBlob(blob, `dotlet-${ts()}${transparent ? '-alpha' : ''}.png`);
      }
    }, 'image/png');
  }, [renderToCanvas]);

  const handleImageToShape = useCallback((img: HTMLImageElement, mode: string, quality: number) => {
    if ((window as any).dotletSynth) (window as any).dotletSynth.generate();

    // 1-to-1 pixel mapping! We will expand the grid to exactly fit the image.
    // To prevent browser crashes on massive images, we cap it at 150x150 internally 
    // if it's too huge, but it's 1-to-1 up to that point.
    const MAX_DIM = 150; 
    let w = img.width;
    let h = img.height;
    if (w > MAX_DIM || h > MAX_DIM) {
      const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
      w = Math.floor(w * scale);
      h = Math.floor(h * scale);
    }

    const newGridSize = Math.max(w, h, gridSize);
    setGridSize(newGridSize); // Expand grid to fit image
    
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let newDots: Dot[] = [];
    const markId = nextMarkId.current++;
    const alphaThreshold = Math.max(5, 255 - Math.floor((quality / 100) * 250));

    const getPix = (cx: number, cy: number) => {
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (cy * w + cx) * 4;
      return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
    };

    const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

    const targetLayerId = activeLayerId || undefined;
    const startX = Math.floor((newGridSize - w) / 2);
    const startY = Math.floor((newGridSize - h) / 2);

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const p = getPix(col, row);
        if (p.a >= alphaThreshold) {
          let place = true;
          if (mode === 'outline') {
            const n1 = getPix(col - 1, row);
            const n2 = getPix(col + 1, row);
            const n3 = getPix(col, row - 1);
            const n4 = getPix(col, row + 1);
            if (n1.a >= alphaThreshold && n2.a >= alphaThreshold && n3.a >= alphaThreshold && n4.a >= alphaThreshold) {
              place = false;
            }
          }
          if (place) {
            newDots.push({
              id: `img-${Date.now()}-${col}-${row}`,
              col: startX + col,
              row: startY + row,
              shape: 'circle', // Force circle for image uploads
              clusterId: 0, markId,
              layerId: targetLayerId,
              colorOverride: rgbToHex(p.r, p.g, p.b), // Exact color!
              sizeOverride: 0.25 // Tiny dots (vs default 0.56)
            });
          }
        }
      }
    }

    if (mode === 'organic') {
      setSpread(80);
      setCrispness(15);
    } else if (mode === 'outline') {
      setOutlineMode(true);
      setOutlineWeight(2);
    } else {
      // For exact 1-to-1 tiny dots, usually you want no blur.
      setSpread(0);
      setCrispness(1);
      setOutlineMode(false);
    }

    const unique = new Map<string, Dot>();
    dots.forEach(d => unique.set(`${d.col},${d.row}`, d));
    newDots.forEach(d => unique.set(`${d.col},${d.row}`, d));
    const combined = Array.from(unique.values());
    handleMarkComplete(combined);

  }, [dots, gridSize, activeLayerId, handleMarkComplete]);

  const LAYER_COLORS = ['#f77847', '#ffc1fa', '#c1d7ff', '#fefa75', '#6e0001', '#5ec4b0', '#e85d75', '#a78bfa'];

  const handleAddLayer = useCallback(() => {
    const id = crypto.randomUUID();
    const color = LAYER_COLORS[customLayers.length % LAYER_COLORS.length];
    // Base layer occupies the "Layer 1" name, so custom layers start at 2.
    setCustomLayers(prev => [...prev, { id, name: `Layer ${prev.length + 2}`, color, visible: true }]);
    setActiveLayerId(id);
  }, [customLayers.length]);

  const handleDeleteLayer = useCallback((id: string) => {
    setCustomLayers(prev => prev.filter(l => l.id !== id));
    // Deleting a layer destroys its dots — record it so Undo can bring them back.
    const remaining = dots.filter(d => d.layerId !== id);
    setDots(remaining);
    history.push(remaining);
    setActiveLayerId(prev => prev === id ? null : prev);
  }, [dots, history.push]);

  const handleRenameLayer = useCallback((id: string, name: string) => {
    setCustomLayers(prev => prev.map(l => l.id === id ? { ...l, name } : l));
  }, []);

  const handleToggleLayerVisible = useCallback((id: string) => {
    setCustomLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  }, []);

  const sidebarProps = {
    bgLayerVisible, setBgLayerVisible,
    artLayerVisible, setArtLayerVisible,
    dotColor, setDotColor, bgColor, setBgColor,
    swatches: recentColors, onAddSwatch: addRecentColor,
    dockedPickers, onToggleDock: handleToggleDock,
    customLayers, activeLayerId, setActiveLayerId,
    onAddLayer: handleAddLayer,
    onDeleteLayer: handleDeleteLayer,
    onRenameLayer: handleRenameLayer,
    onToggleLayerVisible: handleToggleLayerVisible,
    spread, setSpread,
    crispness, setCrispness,
    outlineMode, setOutlineMode,
    outlineWeight, setOutlineWeight,
    roughness, setRoughness,
    shadowOpacity, setShadowOpacity,
    shadowBlur, setShadowBlur,
    gridSize, setGridSize: handleSetGridSize,
    showGrid, setShowGrid,
    onImageToShape: handleImageToShape,
    onUnpin: () => setSidebarAnchored(false),
    mode, setMode, brush, setBrush, setBrushType,
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <TopHeader fileName={fileName} onRenameFile={handleRenameFile} right={
        <>
          <button
            onClick={() => setIsTourOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors border border-transparent hover:border-border"
          >
            <HelpCircle size={14} /> Start Tour
          </button>
          <SaveButton status={saveStatus} onSave={handleSaveNow} />
          <FileManager
            currentFileId={currentFileId}
            saveStatus={saveStatus}
            onLoad={handleLoadFile}
            onNew={handleNewFile}
            onSaveNow={handleSaveNow}
            onCurrentRenamed={setFileName}
            onCurrentDeleted={() => {
              if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
              setCurrentFileId(null);
              setFileName('Untitled');
              lastSavedRef.current = '';
              setSaveStatus('idle');
            }}
          />
        </>
      } />
      <div className="flex flex-row flex-1 overflow-hidden" style={{ marginTop: 48 }}>

        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden" style={{ background: bgColor }}>
          <Canvas
            ref={canvasRef}
            dots={dots}
            tool={tool}
            dotShape={dotShape}
            dotColor={dotColor}
            bgColor={bgColor}
            gridSize={gridSize}
            showGrid={showGrid}
            spread={spread}
            crispness={crispness}
            outlineMode={outlineMode}
            outlineWeight={outlineWeight}
            roughness={roughness}
            shadowOpacity={shadowOpacity}
            shadowBlur={shadowBlur}
            clusterMode={clusterMode}
            bgLayerVisible={bgLayerVisible}
            artLayerVisible={artLayerVisible}
            customLayers={customLayers}
            activeLayerId={activeLayerId}
            nextMarkId={nextMarkId}
            nextClusterId={nextClusterId}
            onMarkComplete={handleMarkComplete}
            onZoomChange={setZoom}
            onSelectionChange={handleSelectionChange}
            mode={mode}
            strokes={strokes}
            brush={brush}
            onStrokeComplete={handleStrokeComplete}
            onEraseStrokes={handleEraseStrokes}
          />
          <ShapeFloater
            dotShape={dotShape} setDotShape={setDotShape}
            clusterMode={clusterMode} setClusterMode={setClusterMode}
            dotColor={dotColor}
          />
          <FloatingPalette
            tool={tool}
            setTool={setTool}
            onClear={handleClear}
            dotCount={mode === 'freehand' ? strokes.length : dots.length}
            zoom={zoom}
            canUndo={mode === 'freehand' ? strokeCanUndo : history.canUndo}
            canRedo={mode === 'freehand' ? strokeCanRedo : history.canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onExportSVG={handleExportSVG}
            onExportEmbeddedSVG={handleExportTracedSVG}
            onExportPNG={handleExportPNG}
            onCopyPNG={handleCopyPNG}
            soundEnabled={soundEnabled}
            onToggleSound={() => setSoundEnabled(s => !s)}
            selectedCount={selectedIds.length}
            selectionIsGrouped={selectionIsGrouped}
            onGroup={handleGroup}
            onUngroup={handleUngroup}
            onExportSelection={handleExportSelection}
          />
        </div>

        {/* Right sidebar — visible when anchored. The unpin control lives inside
            it, so while hidden this floating button is the only way back. */}
        {sidebarAnchored ? (
          <RightSidebar {...sidebarProps} />
        ) : (
          <button
            onClick={() => setSidebarAnchored(true)}
            title="Pin panel — dock the right sidebar"
            className="fixed right-4 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1.5 px-3 py-2 rounded-lg
                       text-[10px] font-medium bg-card border border-border shadow-lg
                       text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
          >
            <Pin size={14} /> Pin Panel
          </button>
        )}

      </div>

      <ProductTour
        steps={TOUR_STEPS}
        isOpen={isTourOpen}
        onClose={() => setIsTourOpen(false)}
      />

      <TourWelcomeModal
        onStartTour={() => setIsTourOpen(true)}
        onDismiss={() => {}}
      />
    </div>
  );
}
