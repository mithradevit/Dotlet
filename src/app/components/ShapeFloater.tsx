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
