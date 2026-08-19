# Dotlet
## Icon Builder — Functional Requirements Document

**Version:** 1.0 — June 2026

---

## 1. Overview

Dotlet is a browser-based vector creation tool built for designers who are tired of spending hours in Adobe to produce something that should take minutes. Where Illustrator demands precision before creativity, Dotlet flips the workflow: place dots on a grid, watch them merge into organic forms in real time, and walk away with a production-ready SVG.

The scope is intentionally broad. Dotlet handles the full spectrum of vector work — icons, font glyphs, logotypes, custom shapes, symbols, and decorative marks — anything that would otherwise require a path editor, a pen tool, and a lot of patience. The gooey filter engine merges adjacent dots into fluid, organic silhouettes automatically, eliminating the anchor-point wrestling that slows down every Adobe workflow.

The interface is minimal by design. A floating palette surfaces near the cursor; the canvas stays unobstructed. No panels, no docked toolbars, no hidden menus. Every control is one hover away, and every export is one click away — client-side, no server, no upload required.

Dotlet is optimised simultaneously for four use cases: fast sketching at speed, precise fine-tuning of individual marks, playful experimental doodling, and professional asset export for production pipelines.

---

## 2. Core Concepts

| ID | Term | Definition |
|---|---|---|
| DC-01 | **Dot** | A single placed element at a grid node. The fundamental unit in Dotlet. |
| DC-02 | **Mark** | A continuous sequence of dots placed in one pointer-down → up gesture. |
| DC-03 | **Cluster** | One or more marks sharing a gooey filter pass; controlled by Blend / Separate mode. |
| DC-04 | **Gooey filter** | An SVG `feGaussianBlur` + `feColorMatrix` pipeline that merges dots with organic, fluid edges. |
| DC-05 | **Crisp export** | Export with no filter applied — pure vector paths, sharp at any scale. |
| DC-06 | **Gooey export** | Export with the blur + threshold filter baked into the output file. |
| DC-07 | **Palette** | The floating toolbar that surfaces near the cursor; replaces all fixed side panels. |
| DC-08 | **Blend mode** | All dots share a single gooey filter pass and merge together into one organic form. |
| DC-09 | **Separate mode** | Each new mark has an independent filter pass; marks do not merge with each other. |

---

## 3. Functional Requirements

### 3.1 Canvas

| ID | Requirement |
|---|---|
| C-01 | The canvas shall render as an SVG viewport that fills the available browser area responsively. |
| C-02 | The canvas shall maintain a grid of evenly-spaced nodes; cell size = `min(width, height) / gridSize`. |
| C-03 | Grid lines and node indicators shall be toggleable via **Show Grid Overlay** in the floating palette. |
| C-04 | The grid shall support five presets: **8×8, 12×12, 16×16, 24×24, 32×32**. |
| C-05 | Changing grid size shall remap all existing dots to their nearest node in the new grid, deduplicating collisions. |
| C-06 | The canvas shall contain two independently toggleable layers: **Background** and **Artwork**. |
| C-07 | The canvas shall display a subtle animated entrance when a dot is placed, reinforcing the tactile feel of the tool. |

---

### 3.2 Floating Palette

> The floating palette is Dotlet's primary interface surface. It replaces the fixed side panel used in conventional design tools.

| ID | Requirement |
|---|---|
| FP-01 | A compact floating toolbar shall appear anchored to one corner of the canvas (default: bottom-left), draggable to any edge by the user. |
| FP-02 | The palette shall contain: tool selector, dot shape picker, gooey controls, colour swatches, grid toggle, layer toggle, and export actions. |
| FP-03 | Hovering over any palette section shall expand it into a contextual popover; moving away shall collapse it after a 300 ms delay. |
| FP-04 | The palette shall never occlude more than **12%** of the canvas area in its default collapsed state. |
| FP-05 | Keyboard shortcut `Tab` shall cycle focus through palette sections without touching the mouse. |
| FP-06 | A minimal mode (shortcut: `M`) shall reduce the palette to icon-only, hiding all labels. |
| FP-07 | All palette popovers shall dismiss immediately on `Escape`. |

---

### 3.3 Drawing Tools

| ID | Requirement |
|---|---|
| T-01 | The **Pen** tool shall place dots on the canvas by click or click-drag across nodes. |
| T-02 | A single drag gesture (one mark) shall not place two dots on the same node. |
| T-03 | Clicking an occupied node in Pen mode shall remove the existing dot (toggle behaviour). |
| T-04 | Holding `Alt` during a Pen gesture shall temporarily switch to Eraser behaviour for that gesture only. |
| T-05 | Holding `Shift` in Pen mode shall switch to drag-to-reposition mode for existing dots. |
| T-06 | The **Eraser** tool shall remove dots by hover-drag across occupied nodes. |
| T-07 | Keyboard shortcut `P` shall activate Pen; `E` shall activate Eraser. |

---

### 3.4 Dot Shape Types

| ID | Requirement |
|---|---|
| S-01 | Eight dot types shall be available: **Circle, Rounded Square, Diamond, Teardrop, Star (4-pt), Cross, Hexagon,** and **Crescent**. |
| S-02 | All dot types shall snap to the same grid-node positions regardless of their visual geometry. |
| S-03 | Rounded Square dots shall render with a corner radius of exactly **13.4%** of dot size (matching the design token `3.93 / 29.27`). |
| S-04 | Teardrop, Star, Cross, Hexagon, and Crescent types shall use parametric SVG path data scaled to the grid cell size. |
| S-05 | The active dot type shall be visually indicated in the palette with a filled highlight and label. |
| S-06 | Keyboard shortcuts `1`–`8` shall cycle through dot types in palette order. |

---

### 3.5 Gooey Filter

| ID | Requirement |
|---|---|
| F-01 | The gooey effect shall be implemented as: `feGaussianBlur` → `feColorMatrix` alpha-threshold → optional `feMorphology` + `feComposite` for outline mode. |
| F-02 | **Spread** slider (0–100) shall control blur intensity via an exponential curve mapping 0 → 0 and 100 → 60 stdDeviation units. |
| F-03 | **Crispness** slider (1–50) shall control the `feColorMatrix` alpha multiplier, making merged blobs sharper or softer at their edges. |
| F-04 | **Outline Mode** toggle shall produce a hollow outline of the merged shape using `feMorphology dilate` + `feComposite xor`. |
| F-05 | **Outline Weight** slider (1–10 px) shall control the dilation radius when Outline Mode is active. |

---

### 3.6 Mark Grouping

| ID | Requirement |
|---|---|
| G-01 | **Blend mode** shall assign all dots to cluster `0`, so all dots share a single gooey filter pass and merge together. |
| G-02 | **Separate mode** shall assign each new mark a unique cluster ID, so marks have independent filter passes and do not merge with each other. |
| G-03 | The active mode at time of drawing shall be baked into each dot's `clusterId` property. |
| G-04 | A **Regroup** action in the palette shall allow the user to reassign selected marks to an existing or new cluster. |

---

### 3.7 Style Controls

| ID | Requirement |
|---|---|
| ST-01 | **Dot colour**: hex colour picker + text input accessible from the palette; applies globally to all dots on the canvas. |
| ST-02 | **Background colour**: hex colour picker + text input accessible from the palette; applies to the Background layer. |
| ST-03 | Colour changes shall update the canvas in real time without redrawing dots. |
| ST-04 | A quick-swatch row of **8 recent colours** shall appear in the colour popover for rapid reuse. |

---

### 3.8 Layers Panel

| ID | Requirement |
|---|---|
| L-01 | The Layers panel shall be accessible as a popover from the floating palette, not as a permanent side panel. |
| L-02 | Two layers shall be listed: **Background** (colour swatch + label) and **Artwork** (colour swatch + dot count). |
| L-03 | Each layer shall have a visibility toggle (eye icon); hiding a layer removes it from the canvas render immediately. |
| L-04 | Layer visibility shall not affect exports — both layers are always included in exported files. |

---

### 3.9 History (Undo / Redo)

| ID | Requirement |
|---|---|
| H-01 | Every completed mark, dot deletion, drag reposition, and canvas clear shall be saved as a history entry. |
| H-02 | In-progress drags shall not create intermediate history entries. |
| H-03 | The undo stack shall hold a maximum of **50 entries**. |
| H-04 | `Cmd / Ctrl + Z` shall undo; `Cmd / Ctrl + Shift + Z` shall redo. |
| H-05 | Undo and Redo buttons in the palette shall appear disabled (muted) when at the respective history boundary. |

---

### 3.10 Export — PNG

| ID | Requirement |
|---|---|
| P-01 | PNG export shall render at **3× canvas resolution** for high-DPI output. |
| P-02 | **Crisp mode**: the exported PNG shall render dots with no blur filter — pure filled shapes at full sharpness. |
| P-03 | **Gooey mode**: the exported PNG shall bake the full gooey filter (blur + threshold + optional outline) into the raster output. |
| P-04 | The PNG background shall be transparent (alpha channel preserved). |
| P-05 | The filename shall follow the pattern `dotlet-{timestamp}[-outline].png`. |
| P-06 | A **Copy PNG** button shall copy the rendered image to the system clipboard via the Clipboard API. |

---

### 3.11 Export — SVG

| ID | Requirement |
|---|---|
| SV-01 | The exported SVG shall be a valid Adobe Illustrator-compatible file with full namespace declarations: `xmlns`, `xmlns:xlink`, `xmlns:dc`, `xmlns:inkscape`, `xmlns:sodipodi`. |
| SV-02 | The file shall include a generator comment with tool name (`Dotlet`) and ISO timestamp. |
| SV-03 | A `<style>` block shall define two CSS classes: `.background` and `.dot`, populated with current colour values — allowing colour editing without touching individual elements. |
| SV-04 | **Crisp mode**: no `<filter>` or `<defs>` block shall be written; no `filter=` attribute on any group. |
| SV-05 | **Gooey mode**: a `<defs>` block shall contain the full gooey filter definition; each cluster group `<g>` shall reference it via `filter="url(#gooey-filter)"`. |
| SV-06 | The SVG shall contain exactly two named top-level layers using `inkscape:groupmode="layer"`: **Background** and **Artwork**. |
| SV-07 | Within the Artwork layer, each mark cluster shall be its own named sublayer (`id="cluster-{id}"`, `inkscape:label="Blended Cluster"` or `"Mark N"`). |
| SV-08 | This structure shall allow each cluster to be selected, hidden, or deleted independently in Illustrator, Inkscape, and Affinity Designer. |
| SV-09 | The filename shall follow the pattern `dotlet-{timestamp}[-outline].svg`. |

---

### 3.12 Export Quality Toggle

| ID | Requirement |
|---|---|
| EQ-01 | The export popover in the floating palette shall contain a two-option toggle: **Crisp** (default) / **Gooey**. |
| EQ-02 | The selected mode shall apply to both PNG and SVG exports simultaneously. |
| EQ-03 | Crisp shall be the default state on every session load. |

---

## 4. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF-01 | The canvas shall render at interactive frame rates (≥ 30 fps) for designs containing up to 200 dots. |
| NF-02 | All exports shall complete client-side with no server round-trip. |
| NF-03 | The UI shall be responsive; the floating palette shall reflow gracefully at viewport widths down to 480 px. |
| NF-04 | Exported SVG files shall open correctly in Adobe Illustrator CC 2022+, Inkscape 1.x, and Affinity Designer 2.x. |
| NF-05 | The corner radius of Rounded Square dots shall be exactly 13.4% of the dot's bounding size, consistent across canvas render and all export formats. |
| NF-06 | The floating palette shall not use any fixed side-panel or persistent drawer pattern; all secondary controls surface via popovers. |
| NF-07 | The canvas shall remain the dominant visual element at all times; total palette UI area (collapsed) shall not exceed 12% of viewport. |

---

## 5. Naming Conventions

The following terms are used throughout all UI labels, codebase identifiers, and documentation.

| Original (Gooey Icon Builder) | Dotlet |
|---|---|
| Gooey Icon Builder | Dotlet |
| Shape | Dot |
| Stroke | Mark |
| Group | Cluster |
| Merge mode | Blend mode |
| Isolate mode | Separate mode |
| Gooeyness | Spread |
| Sharpness | Crispness |
| Crisp Vector | Crisp |
| With Gooey | Gooey |
| Design layer | Artwork layer |
| `groupId` | `clusterId` |
| `stroke-group-{id}` | `cluster-{id}` |
| Merged Strokes | Blended Cluster |
| Gooey filter | Gooey filter *(unchanged)* |

---

## 6. Out of Scope

| Feature | Why it protects Dotlet |
|---|---|
| Multi-user / collaborative editing | All state is local to a single browser session. A backend dependency would break NF-02. |
| Animated or time-based effects | Dotlet is a static vector tool. Animation export has no mapping to the SVG layer model defined in §3.11. |
| Raster image import or embedding | Dotlet creates from scratch via dots. Embedding raster assets introduces a second rendering pipeline with no connection to the gooey filter engine. |
| Image tracing / raster-to-vector conversion | Auto-tracing is a fundamentally different creative engine. Supporting it would bloat the codebase and dilute the dot-based workflow. |
| Motion and animation export | Lottie, CSS animation, and GSAP output do not map to the static SVG layer model in §3.11. Adding them would require rebuilding the export pipeline entirely. |
| Freeform pen / bezier path editing | Dotlet's core value is removing the need for a pen tool. Supporting bezier handles directly contradicts the grid-dot model and the promise of no anchor-point wrestling. |
| AI-assisted shape generation | Text-to-vector or prompt-to-path generation would introduce a server-side inference dependency, breaking NF-02 (client-side, no server round-trip). |
| CMYK / print colour space export | Dotlet exports RGB SVG and PNG only. CMYK requires ICC profile management and PDF colour pipelines entirely outside the current export model. |
| Plugin or third-party extension API | A plugin system requires a stable versioned internal API. At v1 the architecture is too early to lock down — committing now creates maintenance debt. |
| Font file export (OTF / TTF / WOFF) | Dotlet can create font glyphs visually, but generating installable font files requires glyph metrics, kerning tables, and OpenType spec compliance — a separate engineering problem. |

---

*Dotlet · Functional Requirements Document · v1.0 · June 2026 · MITHRADEVI T*