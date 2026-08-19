const fs = require('fs');
let code = fs.readFileSync('../src/app/components/FloatingPalette.tsx', 'utf8');

code = code.replace(
  /{.*?Standard SVG.*?<\/button>/s,
  `{/* Standard SVG */}
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
                  title="Transparent SVG without background"
                >
                  <Download size={11} /> Alpha SVG
                </button>
              </div>`
);

code = code.replace(
  /{.*?Figma-safe SVG.*?<\/button>/s,
  `{/* Figma-safe SVG */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => { onExportEmbeddedSVG(false); setExportOpen(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                >
                  <Download size={11} /> Figma SVG
                </button>
                <button
                  onClick={() => { onExportEmbeddedSVG(true); setExportOpen(false); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                  title="Transparent raster inside an SVG wrapper"
                >
                  <Download size={11} /> Alpha Figma SVG
                </button>
              </div>`
);

fs.writeFileSync('../src/app/components/FloatingPalette.tsx', code);
