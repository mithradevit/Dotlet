# Dotlet — LinkedIn post

Paste-ready. Swap `[brackets]`. Link goes in the first comment, not the body.

---

## ⭐ The post

> **Dotlet — a vector tool where dots bloom into shapes.**
>
> Built it 0→1. Here's the whole thing in three lines.
>
> **WHO IS IT FOR?**
> → Designers making logos, icons and marks
> → Brand folks who want organic, dot-built forms
> → Anyone who wants pixel-art energy that exports as real vectors
> → People who need SVGs that actually survive Figma
>
> **WHAT WE HAVE**
> → Two canvases — snap-to-grid dots, or freehand
> → Dots merge into each other. Tune smoothness, sharpness, roughness
> → 5 brushes — pen, taper, calligraphy, pencil, marker
> → Stabilisation, so shaky hands still draw clean lines
> → Drop in an image, get it back as dots
> → Layers, groups, marquee select
> → Export SVG, PNG, or copy straight to clipboard
>
> **HOW I BUILT IT**
> → Designed it in Figma, shipped it in React + TypeScript
> → The merge is an SVG filter — blur, then a threshold that re-sharpens
> → Figma ignores that threshold. My exports were correct and useless
> → So I built a tracer: rasterise the effect, trace it back to real vector paths, output a file with zero filters
> → Now it looks identical in Figma, Illustrator, Inkscape, any browser
> → Brush stability is Procreate's trick — the pen chases the cursor instead of snapping to it
>
> Still building: freehand and text don't survive a reload yet. It says so in the UI.
> A feature that quietly eats your work is worse than one that admits it's half-done.
>
> [Optional: Open to 0→1 product design roles. Building the first version, finding the shape of the thing, shipping it.]
>
> #ProductDesign #0to1 #UXDesign #DesignEngineering #CreativeTools

---

## Alternate opening lines

> I built a design tool where dots bloom into vector shapes.

> Spent [X weeks] building a vector tool from zero. Three lines to explain it:

> My exports looked perfect in the browser and broken in Figma. That bug taught me the most.

---

## Attach one of these

1. **10–20s screen recording** — place dots, watch them merge, export. The merge is the hook; a still can't carry it.
2. **Before/after of the Figma bug** — blurry vs crisp. Strongest single image: proves you found *and* fixed a real problem.
3. **Dots vs freehand panel**, side by side — shows the UI adapts.

One artefact per idea. Not a wall of screenshots.

---

## Posting notes

- First two lines are all that show before "…see more" — they carry the post
- Link in the **first comment** (LinkedIn throttles posts with outbound links)
- Tue–Thu, 8–10am, your audience's timezone
- Reply to every comment in the first hour
- Keep the arrow bullets — they scan better on mobile than paragraphs
- If a recruiter comments, reply with a **decision**, not a feature. The tracer story is your best follow-up
