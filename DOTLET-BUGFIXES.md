# Dotlet — bug fix patch

**Instructions for Figma Make:** Replace the full contents of each file listed
below with the code given under its heading. Do not merge or partially apply —
replace each file wholesale. Seven files change. No new files, no deleted files,
no dependency changes.

These files are mutually consistent — `Canvas.tsx`, `RightSidebar.tsx`,
`ShapeFloater.tsx` and `App.tsx` have matching prop changes. Apply all seven
together.

Verified: `vite build` succeeds and `tsc --strict --noEmit` passes with exit 0
across App.tsx and everything it imports. The layers, colour and grid-size
behaviour below was exercised in a browser.

---

## Behaviour changes you asked for

### Colour is chosen by the user, never by the layer
Every dot takes the Shape colour selected in the right panel, on every layer.
A layer groups dots and controls their visibility; it does not dictate colour.
The coloured swatch on a layer row is now only an identity tag.

### Shape and Background colour pickers moved to the right panel
There is a new **Color** section at the top of the right sidebar with Shape and
Background pickers, each with a row of recent colours (the recent-colour list
already existed in the code but was disabled behind an `if (false)`). The
duplicate pickers were removed from the left-hand Shape flyout, which now holds
Shape and Stroke Mode only.

---

## Bugs fixed

### Layers panel did nothing (everything landed in Artwork)
- `Canvas.tsx` only ever *read* `dot.layerId` — it never set one. Every dot the
  pen created had no layer, so it went to Artwork regardless of selection.
- `activeLayerId` was never passed from `App.tsx` to `Canvas.tsx` at all.
- The Artwork visibility toggle gated the entire dot group, so hiding Artwork
  also blanked every custom layer.
- The Artwork row was not clickable, so once you added a layer there was no way
  to set the active layer back to Artwork.

### Changing grid size destroyed the drawing
`handleSetGridSize` clamped every dot into `0..newSize-1` and then de-duplicated
by cell. The pen deliberately draws outside the grid box, so every off-grid dot
was crushed onto a border cell and merged away — a whole stroke could collapse
into a single dot. Grid size is now purely a guide/viewport setting and never
touches dot coordinates. `zoomToFit` now fits the grid box *and* the artwork
bounding box, so off-grid work is not framed out of view.

### Compile errors
- `Canvas.tsx` used `CanvasLayer` in its props without importing it.
- `ShapeFloater.tsx` had a `DOT_LABELS` key `roundedSquare`; the shape is
  `rectangle`. Wrong type, and the Rect tooltip rendered empty.

### Export
- "Alpha SVG" was dead: `handleExportSVG` took no argument, so it ignored the
  `transparent` flag and produced a file identical to the normal SVG.
- The export filter ignored the Roughness and Shadow sliders entirely, so
  exports did not match the canvas. `buildExportSVG` now mirrors `FilterDef`.
- Downloads revoked their object URL synchronously after `.click()`, which
  aborts the download in Firefox and Safari, and leaked the URL on image error.

### Save / load
- Saving dropped `customLayers`, `roughness`, `shadowOpacity`, `shadowBlur`,
  `showGrid` and `dotShape`. Saving a file with custom layers and reloading it
  lost every layer. New fields are optional, so files saved by the old build
  still load.
- Loading did not advance `nextMarkId`/`nextClusterId`, so strokes drawn after a
  load reused ids and merged into existing clusters in Isolate mode.
- Deleting the currently open file left the editor pointing at it, and autosave
  re-created the file 30 seconds later.
- Rename and delete wrote a mutation of possibly-stale state over whatever
  autosave had just written; both now re-read storage first.

### Input and React correctness
- The global Space handler called `preventDefault()` unconditionally, so you
  could not type a space in the Text Composer or a layer-rename field. It now
  skips text inputs, and clears on window blur (alt-tabbing while holding space
  left the canvas stuck in pan mode).
- Wheel zoom called `setPan` inside the `setZoom` updater, and
  `handleSetGridSize` called `history.push` inside a `setDots` updater. Impure
  updaters are double-invoked under StrictMode.
- Deleting a layer destroyed its dots without recording history, so Undo could
  not recover them.
- `findDotNear` used a fixed hit radius, so image-import dots (a quarter of
  normal size) were grabbable from cells away.
- The image-import Mode dropdown defaulted to `silhouette`, which matches no
  option in the list, leaving the select with no valid selection.
- The tour's 500ms rect poll re-fired `scrollIntoView` forever, and when a step's
  target was missing (the sidebar steps while the panel is unpinned) the card was
  not rendered at all, leaving a scrim with no way to advance.
- The floating palette's drag clamp used a hard-coded 400px against a ~700px
  wide palette, letting it run off screen; its Export and Compose popovers did
  not close on outside click.
- Canvas animation timeouts were not cleared on unmount.

---

## Known issue NOT fixed

The **Text Composer is a non-functional stub.** `composerText` in
`FloatingPalette.tsx` is read only by its own Clear button and disabled state.
There is no callback to `App.tsx` and no rendering path — "Anchor" just closes
the popover and discards the text. The tour step in `App.tsx` claims "Text is
anchored to the current canvas view and stays with your artwork", which is not
true. Either implement it (needs a new entity in `types.ts`, rendering in
`Canvas.tsx`, plus export and save/load support) or remove the Compose button
and its tour step.

---

## `src/app/App.tsx`

Replace the entire file with:

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { Canvas, type CanvasHandle } from './components/Canvas';
import { FloatingPalette } from './components/FloatingPalette';
import { RightSidebar } from './components/RightSidebar';
import { ShapeFloater } from './components/ShapeFloater';
import { TopHeader } from './components/TopHeader';
import { FileManager, SaveButton, type SaveStatus, type DotletFile, type CanvasState } from './components/FileManager';
import { getDotSVGString } from './components/dotShapes';
import type { Dot, Tool, DotShape, ClusterMode, GridSize, CanvasLayer } from './types';
import { ProductTour, TourWelcomeModal, type TourStep } from './components/ProductTour';
import { HelpCircle, Pin, PinOff } from 'lucide-react'; // pin panel toggle

const MAX_HISTORY = 50;

const TOUR_STEPS: TourStep[] = [
  {
    target: '#tour-anchor-toggle',
    title: 'Pin Panel',
    content: 'Pins or unpins the right-hand settings panel. Click "Unpin Panel" to dismiss the sidebar and get a full-canvas view. Click "Pin Panel" to bring it back. Your tools are always one tap away.',
    placement: 'bottom',
    spotlightShape: 'circle',
  },
  {
    target: '#tour-tools',
    title: 'Drawing Tools',
    content: 'Pick your active tool: Pen places dots, Eraser removes them, Move drags dots around the canvas, Hand pans the view without drawing. Keyboard shortcuts: P, E, V, H.',
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

  let minCol = 0, maxCol = gridSize - 1;
  let minRow = 0, maxRow = gridSize - 1;
  if (visibleDots.length > 0) {
    const cols = visibleDots.map(d => d.col);
    const rows = visibleDots.map(d => d.row);
    minCol = Math.min(0, ...cols);
    maxCol = Math.max(gridSize - 1, ...cols);
    minRow = Math.min(0, ...rows);
    maxRow = Math.max(gridSize - 1, ...rows);
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


  const [zoom, setZoom] = useState(1);
  const history = useHistory();
  const canvasRef = useRef<CanvasHandle>(null);
  const nextMarkId = useRef(1);
  const nextClusterId = useRef(1);

  const handleMarkComplete = useCallback((finalDots: Dot[]) => {
    setDots(finalDots);
    history.push(finalDots);
  }, [history.push]);

  const handleUndo = useCallback(() => history.undo(setDots), [history.undo]);
  const handleRedo = useCallback(() => history.redo(setDots), [history.redo]);

  const handleClear = useCallback(() => {
    setDots([]);
    history.push([]);
  }, [history.push]);

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

  const saveFile = useCallback(async (fid: string, state: CanvasState) => {
    setSaveStatus('saving');
    try {
      const stored = localStorage.getItem('dotlet_files');
      let files: DotletFile[] = stored ? JSON.parse(stored) : [];
      const existingIdx = files.findIndex(f => f.id === fid);
      
      const newFile: DotletFile = {
        id: fid,
        name: existingIdx >= 0 ? files[existingIdx].name : 'Untitled',
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
    await saveFile(fid, getCanvas());
    synth.save();
  }, [currentFileId, saveFile, getCanvas]);

  const handleNewFile = useCallback(() => {
    setCurrentFileId(crypto.randomUUID());
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
    setCurrentFileId(file.id); setDots(loadedDots);
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
    autosaveTimer.current = setTimeout(() => saveFile(currentFileId, getCanvas()), 30000);
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
  }, [handleUndo, handleRedo]);

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
  const buildSVG = (forceTransparent?: boolean) =>
    buildExportSVG(dots, dotColor, bgColor, forceTransparent ? false : bgLayerVisible, artLayerVisible,
      gridSize, clusterMode, spread, crispness, outlineMode, outlineWeight, customLayers,
      roughness, shadowOpacity, shadowBlur);

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

  const renderToCanvas = useCallback((forceTransparent?: boolean): Promise<HTMLCanvasElement> =>
    new Promise((resolve, reject) => {
      const { svgStr, width, height } = buildSVG(forceTransparent);
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
    setCustomLayers(prev => [...prev, { id, name: `Layer ${prev.length + 1}`, color, visible: true }]);
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
    artDotCount: dots.filter(d => !d.layerId).length,
    dotColor, setDotColor, bgColor, setBgColor,
    recentColors, onAddRecentColor: addRecentColor,
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
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <TopHeader right={
        <>
          <button
            id="tour-anchor-toggle"
            onClick={() => setSidebarAnchored(a => !a)}
            title={sidebarAnchored ? 'Unpin panel — hide the right sidebar' : 'Pin panel — dock the right sidebar'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-md transition-colors border ${
              sidebarAnchored
                ? 'text-primary border-primary/30 bg-primary/6 hover:bg-primary/10'
                : 'text-muted-foreground border-transparent hover:bg-secondary hover:border-border hover:text-foreground'
            }`}
          >
            {sidebarAnchored ? <PinOff size={14} /> : <Pin size={14} />}
            {sidebarAnchored ? 'Unpin Panel' : 'Pin Panel'}
          </button>
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
            onCurrentDeleted={() => {
              if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
              setCurrentFileId(null);
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
            dotCount={dots.length}
            zoom={zoom}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onExportSVG={handleExportSVG}
            onExportEmbeddedSVG={handleExportEmbeddedSVG}
            onExportPNG={handleExportPNG}
            onCopyPNG={handleCopyPNG}
            soundEnabled={soundEnabled}
            onToggleSound={() => setSoundEnabled(s => !s)}
          />
        </div>

        {/* Right sidebar — visible when anchored */}
        {sidebarAnchored && <RightSidebar {...sidebarProps} />}

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
```

## `src/app/components/Canvas.tsx`

Replace the entire file with:

```tsx
import React, {
  useRef, useState, useCallback, useMemo, useEffect,
  forwardRef, useImperativeHandle,
} from 'react';
import type { Dot, Tool, DotShape, ClusterMode, GridSize, CanvasLayer } from '../types';
import { renderDotElement } from './dotShapes';

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
    onMarkComplete, onZoomChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
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

  useImperativeHandle(ref, () => ({ zoomToFit, zoomTo100 }), [zoomToFit, zoomTo100]);
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

    // --- Move tool ---
    if (tool === 'move') {
      const { x: lx, y: ly } = getLogical(e.clientX, e.clientY);
      const hit = findDotNear(lx, ly);

      if (hit) {
        // If the dot is already selected, drag all selected; otherwise select just this one
        const newSelected = selectedIds.has(hit.id) ? selectedIds : new Set<string>([hit.id]);
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
  }, [dots, tool, dotShape, clusterMode, spaceHeld, selectedIds, activeLayerId, layerStamp, getLogical, findDotNear, screenToNode, nextMarkId, nextClusterId, onMarkComplete, addAnim]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Pan
    if (isPanning.current) {
      const dx = e.clientX - panAnchor.current.clientX;
      const dy = e.clientY - panAnchor.current.clientY;
      setPan({ x: panAnchor.current.panX + dx, y: panAnchor.current.panY + dy });
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
        setSelectedIds(new Set(
          dots.filter(d => {
            const cx = d.col * CELL + CELL / 2;
            const cy = d.row * CELL + CELL / 2;
            return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
          }).map(d => d.id)
        ));
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
  }, [dots, tool, dotShape, layerStamp, screenToNode, getLogical, addAnim]);

  const handlePointerUp = useCallback(() => {
    // Pan
    if (isPanning.current) { isPanning.current = false; setPanActive(false); return; }

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
  }, [dots, tool, markDots, erasedIds, dragOffset, onMarkComplete]);

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
    if (!isDraggingDots || selectedDotsDisplay.length === 0) return null;
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
  }, [isDraggingDots, selectedDotsDisplay]);

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

          {/* Gooey dots (non-selected during move drag) — per-layer visibility
              is already applied in gooeyDots. */}
          {gooeyDots.length > 0 && (
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
          {tool === 'move' && selectedDotsDisplay.map(dot => {
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
```

## `src/app/components/FileManager.tsx`

Replace the entire file with:

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, X, Plus, Trash2, FileText, Check, Clock, Save } from 'lucide-react';

export interface CanvasState {
  dots: unknown[]; gridSize: number; dotColor: string; bgColor: string;
  spread: number; crispness: number; outlineMode: boolean; outlineWeight: number; clusterMode: string;
  // Optional so files saved by older builds still load.
  customLayers?: unknown[];
  roughness?: number; shadowOpacity?: number; shadowBlur?: number;
  showGrid?: boolean; dotShape?: string;
}

export interface DotletFile {
  id: string; name: string; updatedAt: string | null; canvas: CanvasState | null;
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'idle';

interface Props {
  currentFileId: string | null; saveStatus: SaveStatus;
  onLoad: (f: DotletFile) => void; onNew: () => void;
  onSaveNow: () => Promise<void>;
  /** Called when the file currently open in the editor is deleted. */
  onCurrentDeleted?: () => void;
}

function ago(iso: string | null) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SaveButton({ status, onSave }: { status: SaveStatus; onSave: () => void }) {
  return (
    <button onClick={onSave} title="Save (Cmd+S)"
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
        status === 'saved' ? 'text-green-600 bg-green-50 hover:bg-green-100'
        : status === 'saving' ? 'text-yellow-600 bg-yellow-50 cursor-wait'
        : status === 'unsaved' ? 'text-primary bg-primary/10 hover:bg-primary/20'
        : 'text-muted-foreground bg-secondary hover:bg-secondary/70'
      }`}>
      {status === 'saving' ? <Clock size={12} /> : status === 'saved' ? <Check size={12} /> : <Save size={12} />}
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'unsaved' ? 'Save' : 'Save'}
    </button>
  );
}

export function FileManager({ currentFileId, saveStatus, onLoad, onNew, onSaveNow, onCurrentDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<DotletFile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const fetchFiles = useCallback(() => {
    try {
      const stored = localStorage.getItem('dotlet_files');
      if (stored) {
        setFiles(JSON.parse(stored));
      } else {
        setFiles([]);
      }
    } catch (e) {
      console.error('Failed to parse files from local storage', e);
      setFiles([]);
    }
  }, []);

  useEffect(() => { if (open) fetchFiles(); }, [open, fetchFiles]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Re-read from storage before writing: autosave writes the same key on a timer,
  // so persisting a mutation of this component's (possibly stale) `files` state
  // would silently roll back whatever autosave just stored.
  const writeFiles = (mutate: (current: DotletFile[]) => DotletFile[]) => {
    let current: DotletFile[] = [];
    try {
      const stored = localStorage.getItem('dotlet_files');
      current = stored ? JSON.parse(stored) : [];
    } catch { current = files; }
    const updated = mutate(current);
    setFiles(updated);
    try {
      localStorage.setItem('dotlet_files', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to write files to local storage', e);
    }
  };

  const commitRename = (id: string) => {
    const name = editName.trim() || 'Untitled';
    writeFiles(cur => cur.map(f => f.id === id ? { ...f, name } : f));
    setEditingId(null);
  };

  const deleteFile = (id: string) => {
    writeFiles(cur => cur.filter(f => f.id !== id));
    setDeleteId(null);
    // Without this the editor keeps the deleted id and autosave re-creates the file.
    if (id === currentFileId) onCurrentDeleted?.();
  };

  return (
    <div ref={drawerRef} className="relative">
      <button onClick={() => setOpen(o => !o)} title="Files"
        className="flex items-center justify-center w-8 h-8 rounded-lg text-foreground hover:bg-secondary transition-colors">
        {open ? <X size={16} /> : <Menu size={16} />}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-white border border-border rounded-2xl shadow-2xl z-[100] overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground truncate">Local Storage</p>
            {saveStatus !== 'idle' && (
              <span className={`text-[10px] flex items-center gap-1 ${saveStatus === 'saved' ? 'text-green-600' : saveStatus === 'saving' ? 'text-yellow-600' : 'text-orange-500'}`}>
                {saveStatus === 'saved' ? <><Check size={10} />Saved</> : saveStatus === 'saving' ? <><Clock size={10} />Saving…</> : 'Unsaved changes'}
              </span>
            )}
          </div>

          <div className="flex gap-2 p-3 border-b border-border">
            <button onClick={() => { onNew(); setOpen(false); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
              <Plus size={12} /> New File
            </button>
            <button onClick={onSaveNow}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] bg-secondary text-foreground hover:bg-secondary/70 transition-colors">
              <Save size={12} /> Save Now
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {files.length === 0 && <p className="text-[11px] text-muted-foreground text-center py-6">No saved files yet</p>}
            {files.map(f => (
              <div key={f.id} className={`group flex items-center gap-2 px-4 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors ${f.id === currentFileId ? 'bg-primary/5 border-l-2 border-primary' : ''}`}>
                <FileText size={13} className="text-muted-foreground flex-shrink-0" />
                {editingId === f.id ? (
                  <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onBlur={() => commitRename(f.id)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(f.id); if (e.key === 'Escape') setEditingId(null); }}
                    className="flex-1 text-[11px] border-b border-primary focus:outline-none bg-transparent"
                    onClick={e => e.stopPropagation()} />
                ) : (
                  <div className="flex-1 min-w-0" onClick={() => { onLoad(f); setOpen(false); }} onDoubleClick={() => { setEditingId(f.id); setEditName(f.name); }}>
                    <p className="text-[11px] font-medium text-foreground truncate">{f.name}</p>
                    <p className="text-[10px] text-muted-foreground">{ago(f.updatedAt)}</p>
                  </div>
                )}
                {deleteId === f.id ? (
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={e => { e.stopPropagation(); deleteFile(f.id); }} className="text-[10px] text-red-500 px-1.5 py-0.5 rounded bg-red-50 hover:bg-red-100">Delete</button>
                    <button onClick={e => { e.stopPropagation(); setDeleteId(null); }} className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">Cancel</button>
                  </div>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setDeleteId(f.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 p-1 flex-shrink-0">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

## `src/app/components/FloatingPalette.tsx`

Replace the entire file with:

```tsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Pen, Eraser, Move, Hand, Trash2, GripVertical, Undo2, Redo2, Download, Copy, Type, X as XIcon, Volume2, VolumeX } from 'lucide-react';
import type { Tool } from '../types';

export interface FloatingPaletteProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  onClear: () => void;
  dotCount: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExportSVG: (transparent?: boolean) => void;
  onExportEmbeddedSVG: (transparent?: boolean) => void;
  onExportPNG: (transparent?: boolean) => void;
  onCopyPNG: (transparent?: boolean) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

const TOOLS: { t: Tool; Icon: React.ElementType; label: string; shortcut: string }[] = [
  { t: 'pen',    Icon: Pen,    label: 'Pen',   shortcut: 'P' },
  { t: 'eraser', Icon: Eraser, label: 'Erase', shortcut: 'E' },
  { t: 'move',   Icon: Move,   label: 'Move',  shortcut: 'V' },
  { t: 'hand',   Icon: Hand,   label: 'Hand',  shortcut: 'H' },
];

export function FloatingPalette({
  tool, setTool,
  onClear, dotCount,
  zoom,
  canUndo, canRedo, onUndo, onRedo,
  onExportSVG, onExportEmbeddedSVG, onExportPNG, onCopyPNG,
  soundEnabled, onToggleSound,
}: FloatingPaletteProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const paletteRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const handleGripDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    const el = paletteRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragState.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handleGripMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const { sx, sy, ox, oy } = dragState.current;
    // Clamp against the palette's real size — the old hard-coded 400 let the
    // (much wider) palette run off the right edge.
    const el = paletteRef.current;
    const w = el?.offsetWidth ?? 400;
    const h = el?.offsetHeight ?? 80;
    const nx = Math.max(0, Math.min(window.innerWidth - w, ox + e.clientX - sx));
    const ny = Math.max(0, Math.min(window.innerHeight - h, oy + e.clientY - sy));
    setPos({ x: nx, y: ny });
  }, []);

  const handleGripUp = useCallback(() => { dragState.current = null; }, []);

  // Close the export / composer popovers when clicking elsewhere.
  useEffect(() => {
    if (!exportOpen && !composerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (paletteRef.current?.contains(e.target as Node)) return;
      setExportOpen(false);
      setComposerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen, composerOpen]);

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { left: 24, bottom: 24 };

  return (
    <div ref={paletteRef} id="tour-tools" className="fixed z-50 select-none" style={style}>
      <div className="flex items-center gap-1 bg-card border border-border rounded-2xl px-2 py-2 shadow-2xl">

        {/* Drag grip */}
        <div
          className="flex flex-col gap-[3px] px-1 cursor-grab active:cursor-grabbing mr-1"
          onPointerDown={handleGripDown}
          onPointerMove={handleGripMove}
          onPointerUp={handleGripUp}
        >
          <GripVertical size={12} className="text-muted-foreground/40" />
        </div>

        {/* Tool buttons — icon + label, matches reference */}
        {TOOLS.map(({ t, Icon, label, shortcut }) => (
          <button
            key={t}
            title={`${label} (${shortcut})`}
            onClick={() => setTool(t)}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-medium transition-colors min-w-[52px] ${
              tool === t
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}

        <div className="w-px h-8 bg-border mx-1" />

        {/* Undo / Redo */}
        <div id="tour-undo-redo" className="flex items-center">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Cmd+Z)"
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-medium transition-colors min-w-[52px] ${
              canUndo
                ? 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                : 'text-muted-foreground/25 cursor-not-allowed'
            }`}
          >
            <Undo2 size={15} />
            Undo
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Cmd+Shift+Z)"
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-medium transition-colors min-w-[52px] ${
              canRedo
                ? 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                : 'text-muted-foreground/25 cursor-not-allowed'
            }`}
          >
            <Redo2 size={15} />
            Redo
          </button>
        </div>

        <div className="w-px h-8 bg-border mx-1" />

        {/* Clear */}
        <button
          onClick={onClear}
          disabled={dotCount === 0}
          title="Clear canvas"
          className={`flex items-center justify-center w-8 h-8 rounded-xl transition-colors ${
            dotCount === 0
              ? 'text-muted-foreground/25 cursor-not-allowed'
              : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          }`}
        >
          <Trash2 size={14} />
        </button>

        <div className="w-px h-8 bg-border mx-1" />

        {/* Export button + popover */}
        <div id="tour-export" className="relative">
          <button
            onClick={() => setExportOpen(o => !o)}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-medium transition-colors min-w-[52px] ${
              exportOpen
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <Download size={15} />
            Export
          </button>

          {exportOpen && (
            <div className="absolute bottom-full mb-2 right-0 w-52 bg-card border border-border rounded-xl shadow-2xl p-3 space-y-2">
              {/* Standard SVG — correct in browsers/Inkscape/Illustrator */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => { onExportSVG(false); setExportOpen(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <Download size={11} /> SVG
                </button>
                <button
                  onClick={() => { onExportSVG(true); setExportOpen(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <Download size={11} /> Alpha SVG
                </button>
              </div>
              {/* Figma-safe SVG — smooth effect baked in as embedded image */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => { onExportEmbeddedSVG(false); setExportOpen(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                  title="Embeds the gooey effect as a raster image inside an SVG wrapper — works in Figma"
                >
                  <Download size={11} /> Figma SVG
                </button>
                <button
                  onClick={() => { onExportEmbeddedSVG(true); setExportOpen(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                  title="Transparent embedded gooey effect"
                >
                  <Download size={11} /> Alpha Figma SVG
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { onExportPNG(false); setExportOpen(false); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                  >
                    <Download size={11} /> PNG
                  </button>
                  <button
                    onClick={() => { onExportPNG(true); setExportOpen(false); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                  >
                    <Download size={11} /> Alpha PNG
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { onCopyPNG(false); setExportOpen(false); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                  >
                    <Copy size={11} /> Copy
                  </button>
                  <button
                    onClick={() => { onCopyPNG(true); setExportOpen(false); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                  >
                    <Copy size={11} /> Copy Alpha
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-8 bg-border mx-1" />

        {/* Text Composer */}
        <div id="tour-composer" className="relative">
          <button
            onClick={() => { setComposerOpen(o => !o); setExportOpen(false); }}
            title="Text composer — type a label anchored to the canvas"
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-medium transition-colors min-w-[52px] ${
              composerOpen
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <Type size={15} />
            Compose
          </button>

          {composerOpen && (
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
                <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
                  Text Composer
                </span>
                <button
                  onClick={() => setComposerOpen(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <XIcon size={12} />
                </button>
              </div>
              <div className="p-3 space-y-2.5">
                <textarea
                  autoFocus
                  rows={3}
                  value={composerText}
                  onChange={e => setComposerText(e.target.value)}
                  placeholder="Type your label or annotation…"
                  className="w-full bg-secondary border border-border rounded-lg px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-primary resize-none leading-relaxed"
                  onKeyDown={e => { if (e.key === 'Escape') setComposerOpen(false); }}
                />
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  Text is anchored to the current canvas view. Use it to label artwork or compose multi-line annotations.
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setComposerText('')}
                    disabled={!composerText}
                    className="flex-1 py-1.5 rounded-lg text-[10px] bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setComposerOpen(false)}
                    className="flex-1 py-1.5 rounded-lg text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Anchor ↩
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-8 bg-border mx-1" />

        {/* Sound toggle */}
        <button
          onClick={onToggleSound}
          title={soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
          className={`flex items-center justify-center w-8 h-8 rounded-xl transition-colors ${
            soundEnabled
              ? 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              : 'text-muted-foreground/30 hover:text-muted-foreground hover:bg-secondary'
          }`}
        >
          {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>

        <div className="w-px h-8 bg-border mx-1" />

        {/* Zoom */}
        <span
          className="text-[11px] tabular-nums text-muted-foreground/60 select-none px-1"
          title="Cmd+0 fit  Cmd+1 100%"
        >
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
```

## `src/app/components/ProductTour.tsx`

Replace the entire file with:

```tsx
import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import DotletLogo from '../../imports/DotletLogo-1';

const TOUR_OFFERED_KEY = 'dotlet_tour_offered';

// ── Welcome modal ────────────────────────────────────────────────────────────

export function TourWelcomeModal({
  onStartTour,
  onDismiss,
}: {
  onStartTour: () => void;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!localStorage.getItem(TOUR_OFFERED_KEY)) setVisible(true);
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  const handle = (action: 'tour' | 'skip') => {
    localStorage.setItem(TOUR_OFFERED_KEY, '1');
    setVisible(false);
    if (action === 'tour') setTimeout(onStartTour, 300);
    else onDismiss();
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9997] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            onClick={() => handle('skip')}
          />
          <motion.div
            className="relative z-10 w-[340px] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            initial={{ scale: 0.88, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 8 }}
            transition={{ type: 'spring', bounce: 0.28, duration: 0.45 }}
          >
            <div className="h-1 bg-primary" />
            <div className="p-7 text-center space-y-5">
              <div className="w-32 h-12 mx-auto flex items-center justify-center text-primary">
                <DotletLogo />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold tracking-tight">Welcome to Dotlet</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Place dots that bloom into organic vector shapes. Want a quick guided tour of all the features?
                </p>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={() => handle('tour')}
                  className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                >
                  <ChevronRight size={14} />
                  Yes, show me around
                </button>
                <button
                  onClick={() => handle('skip')}
                  className="w-full py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TourStep = {
  target: string;
  title: string;
  content: string;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  /** 'rect' (default rounded rectangle) or 'circle' spotlight cutout */
  spotlightShape?: 'rect' | 'circle';
};

interface ProductTourProps {
  steps: TourStep[];
  isOpen: boolean;
  onClose: () => void;
}

// ── Spotlight geometry helpers ───────────────────────────────────────────────

const PAD = 8; // padding around the target element

function getRectProps(r: DOMRect) {
  return {
    x: r.left - PAD,
    y: r.top - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

function getCircleProps(r: DOMRect) {
  return {
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    radius: Math.max(r.width, r.height) / 2 + PAD + 4,
  };
}

// ── Main tour ────────────────────────────────────────────────────────────────

export function ProductTour({ steps, isOpen, onClose }: ProductTourProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = steps[currentStepIndex];
  const isCircle = currentStep?.spotlightShape === 'circle';

  // Track target element's rect
  useEffect(() => {
    if (!isOpen || !currentStep) return;

    const updateRect = () => {
      const el = document.querySelector(currentStep.target);
      setTargetRect(el ? el.getBoundingClientRect() : null);
    };

    updateRect();
    // Scroll once when the step changes. Doing it inside updateRect meant the
    // 500ms poll re-triggered a smooth scroll forever, fighting the user.
    document.querySelector(currentStep.target)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    const interval = setInterval(updateRect, 500);

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      clearInterval(interval);
    };
  }, [isOpen, currentStep]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) setCurrentStepIndex(i => i + 1);
    else onClose();
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) setCurrentStepIndex(i => i - 1);
  };

  // ── Popover positioning ─────────────────────────────────────────────────

  // Fallback: centre the card when the step's target isn't on screen (e.g. the
  // sidebar steps while the panel is unpinned). Previously the card was not
  // rendered at all, leaving a scrim with no way to advance the tour.
  let popoverStyle: React.CSSProperties = {
    top: window.innerHeight / 2,
    left: window.innerWidth / 2,
    transform: 'translate(-50%, -50%)',
  };

  if (targetRect) {
    const POPOVER_PAD = 16;
    const POPOVER_WIDTH = 296;
    const placement = currentStep.placement ?? 'bottom';
    let top = 0;
    let left = 0;
    let transform = '';

    const circleR = isCircle ? getCircleProps(targetRect).radius : 0;
    // For circle: offset from circle edge; for rect: offset from rect edge
    const edgeTop    = isCircle ? targetRect.top  + targetRect.height / 2 - circleR : targetRect.top;
    const edgeBottom = isCircle ? targetRect.top  + targetRect.height / 2 + circleR : targetRect.bottom;
    const edgeLeft   = isCircle ? targetRect.left + targetRect.width  / 2 - circleR : targetRect.left;
    const edgeRight  = isCircle ? targetRect.left + targetRect.width  / 2 + circleR : targetRect.right;

    if (placement === 'bottom') {
      top = edgeBottom + POPOVER_PAD;
      left = targetRect.left + targetRect.width / 2;
      transform = 'translateX(-50%)';
    } else if (placement === 'top') {
      top = edgeTop - POPOVER_PAD;
      left = targetRect.left + targetRect.width / 2;
      transform = 'translate(-50%, -100%)';
    } else if (placement === 'left') {
      top = targetRect.top + targetRect.height / 2;
      left = edgeLeft - POPOVER_PAD;
      transform = 'translate(-100%, -50%)';
    } else if (placement === 'right') {
      top = targetRect.top + targetRect.height / 2;
      left = edgeRight + POPOVER_PAD;
      transform = 'translateY(-50%)';
    }

    // Horizontal clamp for top/bottom placements
    if (placement === 'top' || placement === 'bottom') {
      const minLeft = POPOVER_WIDTH / 2 + POPOVER_PAD;
      const maxLeft = window.innerWidth - POPOVER_WIDTH / 2 - POPOVER_PAD;
      left = Math.max(minLeft, Math.min(maxLeft, left));
    }

    // Vertical clamp for left/right placements
    if (placement === 'left' || placement === 'right') {
      const estH = 160;
      top = Math.max(estH / 2 + POPOVER_PAD, Math.min(window.innerHeight - estH / 2 - POPOVER_PAD, top));
    }

    popoverStyle = { top, left, transform };
  }

  // Geometry for SVG elements
  const rProps  = targetRect ? getRectProps(targetRect)   : null;
  const cProps  = targetRect ? getCircleProps(targetRect) : null;

  const springT = { type: 'spring', bounce: 0, duration: 0.4 } as const;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-auto"
          >
            {/* ── SVG overlay layer ── */}
            <svg
              className="absolute inset-0"
              style={{ width: '100vw', height: '100vh' }}
            >
              <defs>
                <mask id="spotlight-mask">
                  <rect x="0" y="0" width="100%" height="100%" fill="white" />
                  {/* Cutout — shape switches between rect and circle */}
                  {targetRect && !isCircle && rProps && (
                    <motion.rect
                      fill="black"
                      rx="10"
                      initial={false}
                      animate={{ x: rProps.x, y: rProps.y, width: rProps.width, height: rProps.height }}
                      transition={springT}
                    />
                  )}
                  {targetRect && isCircle && cProps && (
                    <motion.circle
                      fill="black"
                      initial={false}
                      animate={{ cx: cProps.cx, cy: cProps.cy, r: cProps.radius }}
                      transition={springT}
                    />
                  )}
                </mask>
              </defs>

              {/* Dark scrim */}
              <rect
                x="0" y="0" width="100%" height="100%"
                fill="rgba(0,0,0,0.62)"
                mask="url(#spotlight-mask)"
                onClick={onClose}
              />

              {/* Glow ring — rect */}
              {targetRect && !isCircle && rProps && (
                <motion.rect
                  fill="none"
                  stroke="rgba(61,94,245,0.8)"
                  strokeWidth="2"
                  rx="10"
                  initial={false}
                  animate={{ x: rProps.x, y: rProps.y, width: rProps.width, height: rProps.height }}
                  transition={springT}
                />
              )}

              {/* Glow ring — circle */}
              {targetRect && isCircle && cProps && (
                <motion.circle
                  fill="none"
                  stroke="rgba(61,94,245,0.8)"
                  strokeWidth="2"
                  initial={false}
                  animate={{ cx: cProps.cx, cy: cProps.cy, r: cProps.radius }}
                  transition={springT}
                />
              )}

              {/* Pulsing outer ring */}
              {targetRect && !isCircle && rProps && (
                <motion.rect
                  fill="none"
                  stroke="rgba(61,94,245,0.2)"
                  strokeWidth="4"
                  rx="14"
                  initial={false}
                  animate={{
                    x: rProps.x - 6,
                    y: rProps.y - 6,
                    width: rProps.width + 12,
                    height: rProps.height + 12,
                    opacity: [0.5, 0.15, 0.5],
                  }}
                  transition={{
                    x: springT, y: springT, width: springT, height: springT,
                    opacity: { repeat: Infinity, duration: 2, ease: 'easeInOut' },
                  }}
                />
              )}
              {targetRect && isCircle && cProps && (
                <motion.circle
                  fill="none"
                  stroke="rgba(61,94,245,0.2)"
                  strokeWidth="4"
                  initial={false}
                  animate={{
                    cx: cProps.cx,
                    cy: cProps.cy,
                    r: cProps.radius + 8,
                    opacity: [0.5, 0.15, 0.5],
                  }}
                  transition={{
                    cx: springT, cy: springT, r: springT,
                    opacity: { repeat: Infinity, duration: 2, ease: 'easeInOut' },
                  }}
                />
              )}
            </svg>

            {/* Click blocker over target so user can't accidentally interact */}
            {targetRect && (
              <div
                className="absolute"
                style={{
                  top: targetRect.top - PAD,
                  left: targetRect.left - PAD,
                  width: targetRect.width + PAD * 2,
                  height: targetRect.height + PAD * 2,
                  zIndex: 10,
                }}
              />
            )}

            {/* ── Popover card ── */}
            {(
              <motion.div
                className="absolute w-[296px] bg-popover text-popover-foreground border border-border shadow-2xl rounded-2xl overflow-hidden z-20 pointer-events-auto"
                initial={false}
                animate={popoverStyle as any}
                transition={springT}
              >
                {/* Progress bar */}
                <div className="relative h-0.5 bg-border">
                  <motion.div
                    className="absolute left-0 top-0 h-full bg-primary"
                    initial={false}
                    animate={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                  />
                </div>

                <div className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {/* Step number badge — light pink from palette */}
                      <span className={`w-5 h-5 flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-[#1a1040] bg-[#ffc1fa] ${isCircle ? 'rounded-full' : 'rounded'}`}>
                        {currentStepIndex + 1}
                      </span>
                      <h3 className="text-sm font-semibold leading-snug">{currentStep.title}</h3>
                    </div>
                    <button
                      onClick={onClose}
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                    {currentStep.content}
                  </p>
                </div>

                <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-t border-border">
                  {/* Step dots */}
                  <div className="flex items-center gap-1">
                    {steps.map((_, i) => (
                      <span
                        key={i}
                        className={`rounded-full transition-all duration-300 ${
                          i === currentStepIndex
                            ? 'w-3 h-1.5 bg-primary'
                            : i < currentStepIndex
                            ? 'w-1.5 h-1.5 bg-primary/40'
                            : 'w-1.5 h-1.5 bg-border'
                        }`}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {currentStepIndex > 0 && (
                      <button
                        onClick={handlePrev}
                        className="flex items-center gap-0.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <ChevronLeft size={12} /> Prev
                      </button>
                    )}
                    {currentStepIndex < steps.length - 1 && (
                      <button
                        onClick={onClose}
                        className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                      >
                        Skip
                      </button>
                    )}
                    <button
                      onClick={handleNext}
                      className="flex items-center gap-0.5 px-3 py-1.5 text-[11px] font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      {currentStepIndex === steps.length - 1 ? 'Finish ✓' : <>Next <ChevronRight size={12} /></>}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

## `src/app/components/RightSidebar.tsx`

Replace the entire file with:

```tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  Eye, EyeOff, Grid3x3, Layers,
  Sparkles, Plus, ChevronDown, Trash2, Pen, ImageIcon, Upload, X, Palette
} from 'lucide-react';
import type { GridSize, CanvasLayer } from '../types';
import { GRID_SIZES } from '../types';

export interface RightSidebarProps {
  bgLayerVisible: boolean; setBgLayerVisible: (v: boolean) => void;
  artLayerVisible: boolean; setArtLayerVisible: (v: boolean) => void;
  artDotCount: number;
  dotColor: string; setDotColor: (c: string) => void;
  bgColor: string; setBgColor: (c: string) => void;
  recentColors: string[];
  onAddRecentColor: (c: string) => void;
  // Custom layers
  customLayers: CanvasLayer[];
  activeLayerId: string | null;
  setActiveLayerId: (id: string | null) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleLayerVisible: (id: string) => void;
  // Effects
  spread: number; setSpread: (v: number) => void;
  crispness: number; setCrispness: (v: number) => void;
  outlineMode: boolean; setOutlineMode: (v: boolean) => void;
  outlineWeight: number; setOutlineWeight: (v: number) => void;
  roughness: number; setRoughness: (v: number) => void;
  shadowOpacity: number; setShadowOpacity: (v: number) => void;
  shadowBlur: number; setShadowBlur: (v: number) => void;
  gridSize: GridSize; setGridSize: (g: GridSize) => void;
  showGrid: boolean; setShowGrid: (v: boolean) => void;
  onImageToShape?: (img: HTMLImageElement, mode: string, quality: number) => void;
}

// ── primitives ─────────────────────────────────────────────────────────────

function SectionHeader({
  icon, label, collapsible, open, onToggle,
}: {
  icon: React.ReactNode; label: string;
  collapsible?: boolean; open?: boolean; onToggle?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/40 sticky top-0 z-10 ${collapsible ? 'cursor-pointer select-none hover:bg-muted/60 transition-colors' : ''}`}
      onClick={collapsible ? onToggle : undefined}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-widest flex-1">{label}</span>
      {collapsible && (
        <ChevronDown
          size={10}
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
        />
      )}
    </div>
  );
}

function Section({ icon, label, children, noPad, id }: {
  icon: React.ReactNode; label: string; children: React.ReactNode; noPad?: boolean; id?: string;
}) {
  return (
    <div id={id} className="border-b border-border">
      <SectionHeader icon={icon} label={label} />
      <div className={noPad ? '' : 'p-5 space-y-4'}>{children}</div>
    </div>
  );
}

function CollapsibleSection({ icon, label, defaultOpen = true, children, noPad, id }: {
  icon: React.ReactNode; label: string; defaultOpen?: boolean;
  children: React.ReactNode; noPad?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="border-b border-border">
      <SectionHeader icon={icon} label={label} collapsible open={open} onToggle={() => setOpen(o => !o)} />
      {open && <div className={noPad ? '' : 'p-4 space-y-3'}>{children}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] text-foreground tabular-nums">{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full cursor-pointer"
        style={{ accentColor: 'var(--primary)' }}
      />
    </div>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}
    >
      <span className={`absolute top-0.5 left-0 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function ColorInput({
  label, color, onChange, recent, onAddRecent,
}: {
  label: string; color: string; onChange: (c: string) => void;
  recent: string[]; onAddRecent: (c: string) => void;
}) {
  const [hex, setHex] = useState(color);
  useEffect(() => setHex(color), [color]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (v: string) => {
    const clean = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) { onChange(clean); onAddRecent(clean); }
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          className="w-6 h-6 rounded border border-border flex-shrink-0 relative overflow-hidden"
          style={{ background: color }}
        >
          <input
            ref={inputRef} type="color" value={color}
            onChange={e => { onChange(e.target.value); setHex(e.target.value); }}
            onBlur={e => onAddRecent(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </button>
        <input
          type="text" value={hex}
          onChange={e => setHex(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commit(hex)}
          maxLength={7} spellCheck={false}
          className="flex-1 bg-secondary border border-border rounded px-1.5 py-0.5 text-[9px] text-foreground focus:outline-none focus:border-primary"
        />
      </div>
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {recent.slice(0, 8).map((c, i) => (
            <button
              key={`${c}-${i}`} title={c}
              onClick={() => { onChange(c); setHex(c); onAddRecent(c); }}
              className="w-4 h-4 rounded border border-border hover:scale-110 transition-transform"
              style={{ background: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Custom layer row ────────────────────────────────────────────────────────

function CustomLayerRow({ layer, active, onSelect, onToggle, onRename, onDelete }: {
  layer: CanvasLayer; active: boolean;
  onSelect: () => void; onToggle: () => void;
  onRename: (name: string) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.name);
  const commit = () => { setEditing(false); onRename(name.trim() || 'Layer'); };
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${active ? 'bg-primary/10 ring-1 ring-primary/30' : 'bg-secondary/50 hover:bg-secondary'}`}
    >
      <span className="w-3.5 h-3.5 rounded border border-border flex-shrink-0" style={{ background: layer.color }} />
      {editing ? (
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          onClick={e => e.stopPropagation()}
          className="flex-1 text-[10px] bg-transparent border-b border-primary focus:outline-none" />
      ) : (
        <span className="flex-1 text-[10px] text-foreground truncate" onDoubleClick={e => { e.stopPropagation(); setEditing(true); }}>{layer.name}</span>
      )}
      <button onClick={e => { e.stopPropagation(); onToggle(); }}
        className={`transition-colors flex-shrink-0 ${layer.visible ? 'text-foreground' : 'text-muted-foreground/30'} hover:text-foreground`}>
        {layer.visible ? <Eye size={11} /> : <EyeOff size={11} />}
      </button>
      <button onClick={e => { e.stopPropagation(); onDelete(); }}
        className="flex-shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors">
        <Trash2 size={10} />
      </button>
    </div>
  );
}

// ── main component ──────────────────────────────────────────────────────────

export function RightSidebar(props: RightSidebarProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imgMode, setImgMode] = useState<string>('colored');
  const [imgQuality, setImgQuality] = useState<number>(50);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setImageSrc(evt.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleGenerateImage = () => {
    if (!imageSrc || !props.onImageToShape) return;
    const img = new Image();
    img.onload = () => props.onImageToShape!(img, imgMode, imgQuality);
    img.src = imageSrc;
  };

  return (
    <aside className="w-72 h-full flex flex-col border-l border-border bg-card shrink-0 overflow-hidden">

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Image to Shape ── */}
        <Section id="tour-image-to-shape" icon={<ImageIcon size={10} />} label="Image to Shape">
          {!imageSrc ? (
            <div className="flex flex-col gap-2">
              <input type="file" accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-secondary text-muted-foreground text-[10px] hover:text-foreground transition-colors border border-dashed border-border hover:border-primary">
                <Upload size={10} /> Upload Image
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative w-full h-24 bg-black/20 rounded-lg overflow-hidden border border-border flex items-center justify-center">
                <img src={imageSrc} className="max-w-full max-h-full object-contain" alt="Preview" />
                <button onClick={() => setImageSrc(null)} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-md hover:bg-black/70"><X size={10} /></button>
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground">Mode</span>
                <select value={imgMode} onChange={e => setImgMode(e.target.value)} className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-[10px] text-foreground focus:outline-none">
                  <option value="colored">Option A: Convert image to colored dots (one layer)</option>
                  <option value="outline">Outline Only</option>
                </select>
              </div>
              <Slider label="Quality (Detail)" value={imgQuality} min={1} max={100} onChange={setImgQuality} />
              <button onClick={handleGenerateImage} className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors">
                Generate Shape
              </button>
            </div>
          )}
        </Section>

        {/* ── Color ── */}
        <Section id="tour-color" icon={<Palette size={10} />} label="Color">
          <ColorInput
            label="Shape"
            color={props.dotColor}
            onChange={props.setDotColor}
            recent={props.recentColors}
            onAddRecent={props.onAddRecentColor}
          />
          <ColorInput
            label="Background"
            color={props.bgColor}
            onChange={props.setBgColor}
            recent={props.recentColors}
            onAddRecent={props.onAddRecentColor}
          />
        </Section>

        {/* ── Layers ── */}
        <CollapsibleSection id="tour-layers" icon={<Layers size={10} />} label="Layers" defaultOpen>
          <div className="space-y-1.5">
            {/* Artwork Layer (Top) — selectable, otherwise adding a custom layer
                leaves no way to draw back into Artwork. */}
            <div
              onClick={() => props.setActiveLayerId(null)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                props.activeLayerId === null
                  ? 'bg-primary/10 ring-1 ring-primary/30'
                  : 'bg-secondary/50 hover:bg-secondary'
              }`}
            >
              <span className="w-3.5 h-3.5 rounded border border-border flex-shrink-0" style={{ background: props.dotColor }} />
              <span className="flex-1 text-[10px] text-foreground truncate">Artwork ({props.artDotCount})</span>
              <button onClick={e => { e.stopPropagation(); props.setArtLayerVisible(!props.artLayerVisible); }} className={`transition-colors ${props.artLayerVisible ? 'text-foreground' : 'text-muted-foreground/30'} hover:text-foreground`}>
                {props.artLayerVisible ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
            </div>

            {/* Custom layers */}
            {props.customLayers.map(layer => (
              <CustomLayerRow
                key={layer.id}
                layer={layer}
                active={props.activeLayerId === layer.id}
                onSelect={() => props.setActiveLayerId(layer.id)}
                onToggle={() => props.onToggleLayerVisible(layer.id)}
                onRename={(name) => props.onRenameLayer(layer.id, name)}
                onDelete={() => props.onDeleteLayer(layer.id)}
              />
            ))}

            {/* Background Layer (Bottom) */}
            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
              <span className="w-3.5 h-3.5 rounded border border-border flex-shrink-0" style={{ background: props.bgColor }} />
              <span className="flex-1 text-[10px] text-foreground truncate">Background</span>
              <button onClick={() => props.setBgLayerVisible(!props.bgLayerVisible)} className={`transition-colors ${props.bgLayerVisible ? 'text-foreground' : 'text-muted-foreground/30'} hover:text-foreground`}>
                {props.bgLayerVisible ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
            </div>
          </div>
          <button
            onClick={props.onAddLayer}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] text-muted-foreground border border-dashed border-border hover:border-primary hover:text-primary transition-colors"
          >
            <Plus size={10} /> Add Layer
          </button>
        </CollapsibleSection>

        {/* ── Effects ── */}
        <Section id="tour-effects" icon={<Sparkles size={10} />} label="Effects">
          <Slider label="Smoothness" value={props.spread} min={0} max={100} onChange={props.setSpread} />
          <Slider label="Sharpness" value={props.crispness} min={1} max={50} onChange={props.setCrispness} />
          <Slider label="Roughness" value={props.roughness} min={0} max={100} onChange={props.setRoughness} />
          <div className="border-t border-border pt-3 space-y-3">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Shadow</span>
            <Slider label="Opacity" value={props.shadowOpacity} min={0} max={100} onChange={props.setShadowOpacity} />
            {props.shadowOpacity > 0 && (
              <Slider label="Blur" value={props.shadowBlur} min={1} max={30} onChange={props.setShadowBlur} />
            )}
          </div>
          <div className="border-t border-border pt-3 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Outline Mode</span>
            <Toggle on={props.outlineMode} onToggle={() => props.setOutlineMode(!props.outlineMode)} />
          </div>
          {props.outlineMode && (
            <Slider label="Outline Width" value={props.outlineWeight} min={1} max={10} onChange={props.setOutlineWeight} />
          )}
        </Section>

        {/* ── Grid ── */}
        <CollapsibleSection id="tour-grid" icon={<Grid3x3 size={10} />} label="Grid" defaultOpen>
          <div className="space-y-2">
            <span className="text-[10px] text-muted-foreground">Size</span>
            <div className="flex gap-1.5">
              {GRID_SIZES.map(g => (
                <button
                  key={g}
                  onClick={() => props.setGridSize(g)}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-medium transition-colors ${
                    props.gridSize === g
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Show Grid</span>
            <Toggle on={props.showGrid} onToggle={() => props.setShowGrid(!props.showGrid)} />
          </div>
        </CollapsibleSection>

      </div>
    </aside>
  );
}
```

## `src/app/components/ShapeFloater.tsx`

Replace the entire file with:

```tsx
import React, { useState, useRef, useEffect } from 'react';
import type { DotShape, ClusterMode } from '../types';
import { DOT_SHAPES } from '../types';
import { ShapePreview } from './dotShapes';

const DOT_LABELS: Record<DotShape, string> = {
  circle: 'Circle', rectangle: 'Rect', diamond: 'Diamond',
  teardrop: 'Tear', star4: 'Star', cross: 'Cross',
  hexagon: 'Hex', crescent: 'Moon',
};

interface ShapeFloaterProps {
  dotShape: DotShape; setDotShape: (s: DotShape) => void;
  clusterMode: ClusterMode; setClusterMode: (m: ClusterMode) => void;
  /** Used only to tint the FAB preview — colour is edited in the right panel. */
  dotColor: string;
}

function MiniColorPicker({ label, color, onChange }: {
  label: string; color: string; onChange: (c: string) => void;
}) {
  const [hex, setHex] = useState(color);
  useEffect(() => setHex(color), [color]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (v: string) => {
    const clean = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) onChange(clean);
  };

  return (
    <div className="flex-1 space-y-1">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => inputRef.current?.click()}
          className="w-5 h-5 rounded border border-border flex-shrink-0 relative overflow-hidden"
          style={{ background: color }}
        >
          <input
            ref={inputRef} type="color" value={color}
            onChange={e => { onChange(e.target.value); setHex(e.target.value); }}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </button>
        <input
          type="text" value={hex}
          onChange={e => setHex(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commit(hex)}
          maxLength={7} spellCheck={false}
          className="flex-1 min-w-0 bg-secondary border border-border rounded px-1.5 py-0.5 text-[9px] text-foreground focus:outline-none focus:border-primary"
        />
      </div>
    </div>
  );
}

export function ShapeFloater({ dotShape, setDotShape, clusterMode, setClusterMode, dotColor }: ShapeFloaterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div
      ref={ref}
      className="fixed z-40 select-none"
      style={{ left: 24, top: '50%', transform: 'translateY(-50%)' }}
    >
      {/* Expanded panel — slides in from left */}
      {open && (
        <div className="absolute left-14 top-1/2 -translate-y-1/2 w-56 bg-card border border-border rounded-2xl shadow-2xl p-4 space-y-4">

          {/* Shape grid */}
          <div className="space-y-2">
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-widest">Shape</span>
            <div className="grid grid-cols-4 gap-1.5 overflow-visible">
              {DOT_SHAPES.map((s, i) => (
                <div key={s} className="group relative">
                  <button
                    onClick={() => setDotShape(s)}
                    title={`${DOT_LABELS[s]} (${i + 1})`}
                    className={`w-full flex items-center justify-center py-2.5 rounded-lg transition-colors ${
                      dotShape === s
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                    }`}
                  >
                    <ShapePreview shape={s} size={13} />
                  </button>
                  <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 px-1.5 py-0.5 rounded bg-foreground text-background text-[9px] whitespace-nowrap shadow opacity-0 group-hover:opacity-100 transition-opacity z-20">
                    {DOT_LABELS[s]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Stroke mode */}
          <div className="space-y-2">
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-widest">Stroke Mode</span>
            <div className="flex gap-1.5">
              {(['blend', 'separate'] as ClusterMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setClusterMode(m)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                    clusterMode === m
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                  }`}
                >
                  {m === 'blend' ? 'Merge' : 'Isolate'}
                </button>
              ))}
            </div>
          </div>

          {/* Colour lives in the right panel's Color section — not duplicated here. */}
        </div>
      )}

      {/* Round FAB */}
      <button
        id="tour-shape-fab"
        onClick={() => setOpen(o => !o)}
        className={`w-11 h-11 rounded-full shadow-xl flex items-center justify-center transition-all border ${
          open
            ? 'bg-primary text-primary-foreground border-primary scale-110'
            : 'bg-card text-foreground border-border hover:border-primary hover:scale-105'
        }`}
        title="Shape & Color"
      >
        <ShapePreview shape={dotShape} size={18} color={open ? 'white' : dotColor} />
      </button>
    </div>
  );
}
```

---

End of patch. Seven files, all replaced in full.
