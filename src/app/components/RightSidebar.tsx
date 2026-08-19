import React, { useState, useRef, useEffect } from 'react';
import {
  Eye, EyeOff, Grid3x3, Layers,
  Sparkles, Plus, ChevronDown, Trash2, Pen, ImageIcon, Upload, X, Palette, PinOff, Brush
} from 'lucide-react';
import type { GridSize, CanvasLayer, CanvasMode, BrushSettings, BrushType } from '../types';
import { GRID_SIZES } from '../types';
import { BRUSH_LABELS } from '../lib/stroke';
import { ColorPicker } from './ColorPicker';

export interface RightSidebarProps {
  bgLayerVisible: boolean; setBgLayerVisible: (v: boolean) => void;
  artLayerVisible: boolean; setArtLayerVisible: (v: boolean) => void;
  dotColor: string; setDotColor: (c: string) => void;
  bgColor: string; setBgColor: (c: string) => void;
  /** User-saved colours, shared by both pickers. */
  swatches: string[];
  onAddSwatch: (c: string) => void;
  /** Which pickers show their sliders inline instead of in a popover. */
  dockedPickers: { shape: boolean; background: boolean };
  onToggleDock: (which: 'shape' | 'background') => void;
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
  /** Hide the panel. App renders a floating re-pin button while it's hidden. */
  onUnpin: () => void;
  // ── Canvas mode ──
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
  brush: BrushSettings;
  setBrush: (b: BrushSettings) => void;
  setBrushType: (t: BrushType) => void;
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
      {/* Travel must be expressed in rem, like the track (w-8 = 2rem) and knob
          (w-3 = 0.75rem, inset 0.125rem). A hard-coded 18px does not scale with
          the root font size, so the knob overflowed the pill's right edge:
          2 - 0.75 - 0.125 = 1.125rem. */}
      <span className={`absolute top-0.5 left-0 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`} />
    </button>
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

      {/* Panel bar — holds the unpin control */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-widest">Panel</span>
        <button
          id="tour-anchor-toggle"
          onClick={props.onUnpin}
          title="Unpin panel — hide the right sidebar"
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium rounded-md border border-transparent
                     text-muted-foreground hover:bg-secondary hover:border-border hover:text-foreground transition-colors"
        >
          <PinOff size={12} /> Unpin
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Canvas mode ──
            Sits above everything because it governs everything: the sections
            below are contextual to it. Deliberately not inside Grid — grid is a
            setting *of* dot mode, not a peer of the mode itself. */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex p-0.5 rounded-lg bg-secondary">
            {([
              ['dots', 'Dots'],
              ['freehand', 'Freehand'],
            ] as [CanvasMode, string][]).map(([m, label]) => (
              <button
                key={m}
                onClick={() => props.setMode(m)}
                className={`flex-1 py-1.5 rounded-md text-[10px] font-medium transition-colors ${
                  props.mode === m
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Brush (freehand only) ── */}
        {props.mode === 'freehand' && (
          <Section id="tour-brush" icon={<Brush size={10} />} label="Brush">
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(BRUSH_LABELS) as BrushType[]).map(t => (
                <button
                  key={t}
                  onClick={() => props.setBrushType(t)}
                  className={`py-2 rounded-lg text-[9px] font-medium transition-colors ${
                    props.brush.type === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                  }`}
                >
                  {BRUSH_LABELS[t]}
                </button>
              ))}
            </div>
            <Slider label="Size" value={props.brush.size} min={1} max={80}
              onChange={v => props.setBrush({ ...props.brush, size: v })} />
            <Slider label="Opacity" value={props.brush.opacity} min={5} max={100}
              onChange={v => props.setBrush({ ...props.brush, opacity: v })} />
            {/* Procreate's StreamLine — higher values lag the pen behind the
                cursor, smoothing out hand tremor. */}
            <Slider label="Stability" value={props.brush.streamline} min={0} max={95}
              onChange={v => props.setBrush({ ...props.brush, streamline: v })} />
            {props.brush.type === 'calligraphy' && (
              <Slider label="Nib Angle" value={props.brush.angle} min={0} max={180}
                onChange={v => props.setBrush({ ...props.brush, angle: v })} />
            )}
            {props.brush.type === 'pencil' && (
              <Slider label="Grain" value={props.brush.grain} min={0} max={100}
                onChange={v => props.setBrush({ ...props.brush, grain: v })} />
            )}
          </Section>
        )}

        {/* ── Image to Shape (dots only) ── */}
        {props.mode === 'dots' && (
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
        )}

        {/* ── Color ── */}
        <Section id="tour-color" icon={<Palette size={10} />} label="Color">
          <ColorPicker
            label="Shape"
            color={props.dotColor}
            onChange={props.setDotColor}
            swatches={props.swatches}
            onAddSwatch={props.onAddSwatch}
            docked={props.dockedPickers.shape}
            onToggleDock={() => props.onToggleDock('shape')}
          />
          <div className="h-px bg-border" />
          <ColorPicker
            label="Background"
            color={props.bgColor}
            onChange={props.setBgColor}
            swatches={props.swatches}
            onAddSwatch={props.onAddSwatch}
            docked={props.dockedPickers.background}
            onToggleDock={() => props.onToggleDock('background')}
          />
        </Section>

        {/* ── Layers ── */}
        <CollapsibleSection id="tour-layers" icon={<Layers size={10} />} label="Layers" defaultOpen>
          <div className="space-y-1.5">
            {/* Base layer (Top) — selectable, otherwise adding a custom layer
                leaves no way to draw back into it. No colour swatch: layers
                group dots, they don't determine colour. */}
            <div
              onClick={() => props.setActiveLayerId(null)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                props.activeLayerId === null
                  ? 'bg-primary/10 ring-1 ring-primary/30'
                  : 'bg-secondary/50 hover:bg-secondary'
              }`}
            >
              <span className="flex-1 text-[10px] text-foreground truncate">Layer 1</span>
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

        {/* ── Effects (dots only — the gooey merge is a dot-mode concept) ── */}
        {props.mode === 'dots' && (
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
        )}

        {/* ── Grid (dots only — freehand isn't lattice-snapped) ── */}
        {props.mode === 'dots' && (
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
        )}

      </div>
    </aside>
  );
}
