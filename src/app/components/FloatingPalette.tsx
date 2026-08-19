import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Pen, Eraser, MousePointer2, Hand, Trash2, GripVertical, Undo2, Redo2, Download, Copy, Type, X as XIcon, Volume2, VolumeX, Group, Ungroup } from 'lucide-react';
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
  // ── Selection / grouping (Move tool) ──
  selectedCount: number;
  selectionIsGrouped: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onExportSelection: (format: 'svg' | 'png') => void;
}

const TOOLS: { t: Tool; Icon: React.ElementType; label: string; shortcut: string }[] = [
  { t: 'pen',    Icon: Pen,    label: 'Pen',   shortcut: 'P' },
  { t: 'eraser', Icon: Eraser, label: 'Erase', shortcut: 'E' },
  // Arrow pointer: this tool selects (click, shift-click, marquee) and drags.
  { t: 'move',   Icon: MousePointer2, label: 'Select', shortcut: 'V' },
  { t: 'hand',   Icon: Hand,   label: 'Hand',  shortcut: 'H' },
];

export function FloatingPalette({
  tool, setTool,
  onClear, dotCount,
  zoom,
  canUndo, canRedo, onUndo, onRedo,
  onExportSVG, onExportEmbeddedSVG, onExportPNG, onCopyPNG,
  soundEnabled, onToggleSound,
  selectedCount, selectionIsGrouped, onGroup, onUngroup, onExportSelection,
}: FloatingPaletteProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  /** Transparency modifier applied to whichever export is chosen. */
  const [alpha, setAlpha] = useState(false);
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

      {/* Selection bar — only while dots are selected with the Select tool.
          Mirrors the main palette's shell (same radius, border, shadow, divider
          rhythm) so the two rows read as one control surface. Every button uses
          the same icon+label treatment and the same 28px hit height. */}
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center gap-1 bg-card border border-border rounded-2xl px-2 py-2 shadow-2xl w-fit">

          {/* Status: a count pill, visually distinct from the actions */}
          <span className="flex items-center h-7 px-2.5 rounded-lg bg-secondary text-[10px] font-medium text-foreground tabular-nums">
            {selectedCount} selected
          </span>

          <div className="w-px h-5 bg-border mx-1" />

          <button
            onClick={onGroup}
            disabled={selectedCount < 2}
            title="Group selection (Cmd+G)"
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-medium transition-colors ${
              selectedCount < 2
                ? 'text-muted-foreground/25 cursor-not-allowed'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <Group size={13} /> Group
          </button>
          <button
            onClick={onUngroup}
            disabled={!selectionIsGrouped}
            title="Ungroup selection (Cmd+Shift+G)"
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-medium transition-colors ${
              !selectionIsGrouped
                ? 'text-muted-foreground/25 cursor-not-allowed'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <Ungroup size={13} /> Ungroup
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Export: one primary action, one secondary — not two competing fills */}
          <button
            onClick={() => onExportSelection('svg')}
            title="Export this selection as SVG, cropped to its bounds"
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-medium
                       bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Download size={13} /> SVG
          </button>
          <button
            onClick={() => onExportSelection('png')}
            title="Export this selection as PNG, cropped to its bounds"
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-medium
                       text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Download size={13} /> PNG
          </button>
        </div>
      )}

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
            <div className="absolute bottom-full mb-2 right-0 w-64 bg-card border border-border rounded-2xl shadow-2xl p-4">

              {/* ── Options ── */}
              {/* Transparency is a property of the export, not four extra
                  buttons — one toggle replaces every "Alpha …" duplicate. */}
              <button
                onClick={() => setAlpha(a => !a)}
                className="w-full flex items-center justify-between gap-3 py-1 group/opt"
                title="Export without the background colour"
              >
                <span className="text-[10px] text-muted-foreground group-hover/opt:text-foreground transition-colors">
                  Transparent background
                </span>
                <span className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${alpha ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                  <span className={`absolute top-0.5 left-0 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${alpha ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`} />
                </span>
              </button>

              <div className="h-px bg-border my-3.5" />

              {/* ── Format ── */}
              <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-widest mb-2.5">
                Format
              </p>
              <div className="space-y-1.5">
                {/* Primary: traced paths. The only SVG that renders correctly
                    everywhere, so it leads. */}
                <button
                  onClick={() => { onExportEmbeddedSVG(alpha); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  title="Merged shape traced into real vector paths — no SVG filter, so it looks identical in Figma"
                >
                  <Download size={13} className="flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-medium leading-snug">SVG — Vector</span>
                    <span className="block text-[9px] opacity-75 leading-snug mt-0.5">Works in Figma</span>
                  </span>
                </button>

                {/* Secondary: filter-based, keeps every dot as its own element */}
                <button
                  onClick={() => { onExportSVG(alpha); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                  title="Each dot stays a separate editable element, merged via an SVG filter. Figma cannot render this filter."
                >
                  <Download size={13} className="flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-medium leading-snug">SVG — Editable dots</span>
                    <span className="block text-[9px] text-muted-foreground leading-snug mt-0.5">Not supported in Figma</span>
                  </span>
                </button>

                <div className="flex gap-1.5 pt-1">
                  <button
                    onClick={() => { onExportPNG(alpha); setExportOpen(false); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                    title="Raster PNG at 3× resolution"
                  >
                    <Download size={12} /> PNG
                  </button>
                  <button
                    onClick={() => { onCopyPNG(alpha); setExportOpen(false); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                    title="Copy a PNG to the clipboard"
                  >
                    <Copy size={12} /> Copy
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
