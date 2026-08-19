import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Pipette, Check, PanelRight, X } from 'lucide-react';

/**
 * HSL colour picker, styled to the Dotlet system.
 *
 * Two presentations, user's choice:
 *   • popover (default) — the panel stays a compact swatch row, sliders appear
 *     on click and get out of the way again
 *   • docked — sliders live inline in the right panel, always visible
 *
 * HSL rather than raw RGB because the useful edits here are "same colour,
 * lighter" and "less saturated" — single-slider moves in HSL, awkward in RGB.
 * Each track paints the actual outcome of moving it, so the control previews
 * itself.
 */

// ── conversion ──────────────────────────────────────────────────────────────

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0, s: 0, l: 0 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const v = L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ── slider ──────────────────────────────────────────────────────────────────

function ChannelSlider({
  value, min, max, gradient, onChange,
}: {
  value: number; min: number; max: number; gradient: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 h-3">
        <div
          className="absolute inset-0 rounded-full border border-border/60"
          style={{ background: gradient }}
        />
        <input
          type="range" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="dotlet-channel absolute inset-0 w-full h-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <span className="w-7 text-right text-[10px] text-muted-foreground tabular-nums">
        {Math.round(value)}
      </span>
    </div>
  );
}

// ── picker ──────────────────────────────────────────────────────────────────

export function ColorPicker({
  label, color, onChange, swatches, onAddSwatch, docked, onToggleDock,
}: {
  label: string;
  color: string;
  onChange: (c: string) => void;
  swatches: string[];
  onAddSwatch: (c: string) => void;
  /** Sliders inline in the panel (true) or in a popover on click (false). */
  docked: boolean;
  onToggleDock: () => void;
}) {
  const { h, s, l } = hexToHsl(color);
  const [hex, setHex] = useState(color);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => setHex(color), [color]);

  // The sidebar scrolls, which clips absolutely-positioned children, so the
  // popover is fixed and anchored to the swatch instead.
  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 232;
    setPos({
      top: Math.min(window.innerHeight - 300, Math.max(8, r.top - 8)),
      left: Math.max(8, r.left - W - 12),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const commitHex = (v: string) => {
    const clean = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) onChange(clean.toLowerCase());
    else setHex(color);
  };

  const set = (nh: number, ns: number, nl: number) => onChange(hslToHex(nh, ns, nl));
  const alreadySaved = swatches.some(c => c.toLowerCase() === color.toLowerCase());

  /** Hex field, channels and swatches — shared by both presentations. */
  const controls = (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <input
          type="text" value={hex}
          onChange={e => setHex(e.target.value)}
          onBlur={e => commitHex(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitHex(hex); }}
          maxLength={7} spellCheck={false}
          className="flex-1 min-w-0 bg-secondary border border-border rounded px-2 py-1 text-[10px] text-foreground uppercase focus:outline-none focus:border-primary"
        />
        <button
          onClick={() => nativeRef.current?.click()}
          title="Pick from screen"
          className="relative w-6 h-6 rounded border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
        >
          <Pipette size={11} />
          <input
            ref={nativeRef} type="color" value={color}
            onChange={e => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </button>
        <span className="text-[9px] text-muted-foreground uppercase tracking-widest">HSL</span>
      </div>

      <div className="space-y-1.5">
        <ChannelSlider
          value={h} min={0} max={360}
          gradient="linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)"
          onChange={v => set(v, s, l)}
        />
        <ChannelSlider
          value={s} min={0} max={100}
          gradient={`linear-gradient(to right, ${hslToHex(h, 0, l)}, ${hslToHex(h, 100, l)})`}
          onChange={v => set(h, v, l)}
        />
        <ChannelSlider
          value={l} min={0} max={100}
          gradient={`linear-gradient(to right, #000, ${hslToHex(h, s, 50)}, #fff)`}
          onChange={v => set(h, s, v)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {swatches.map((c, i) => (
          <button
            key={`${c}-${i}`}
            title={c}
            onClick={() => onChange(c)}
            className={`w-5 h-5 rounded-md border transition-transform hover:scale-110 ${
              c.toLowerCase() === color.toLowerCase() ? 'border-primary ring-1 ring-primary/40' : 'border-border'
            }`}
            style={{ background: c }}
          />
        ))}
        <button
          onClick={() => onAddSwatch(color)}
          disabled={alreadySaved}
          title={alreadySaved ? 'Already saved' : 'Save this colour'}
          className={`w-5 h-5 rounded-md border border-dashed flex items-center justify-center transition-colors ${
            alreadySaved
              ? 'border-border text-muted-foreground/30 cursor-not-allowed'
              : 'border-border text-muted-foreground hover:border-primary hover:text-primary'
          }`}
        >
          {alreadySaved ? <Check size={10} /> : <Plus size={10} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Compact row — always present */}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[10px] text-muted-foreground">{label}</span>
        {docked && (
          <button
            onClick={onToggleDock}
            title="Undock — show these sliders in a popover instead"
            className="text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <button
        ref={anchorRef}
        onClick={() => { if (!docked) setOpen(o => !o); }}
        title={docked ? color : 'Click to edit colour'}
        className={`relative w-full h-9 rounded-lg border overflow-hidden transition-colors ${
          open ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/60'
        }`}
        style={{ background: color }}
      >
        <span className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-black/25 text-white text-[9px] uppercase tabular-nums backdrop-blur-sm">
          {color}
        </span>
      </button>

      {/* Docked: inline in the panel */}
      {docked && controls}

      {/* Undocked: popover anchored to the swatch */}
      {!docked && open && (
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 232 }}
          className="z-[120] bg-card border border-border rounded-xl shadow-2xl p-3.5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-widest">
              {label}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { onToggleDock(); setOpen(false); }}
                title="Dock to the right panel"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <PanelRight size={12} />
              </button>
              <button
                onClick={() => setOpen(false)}
                title="Close"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          {controls}
        </div>
      )}
    </div>
  );
}
