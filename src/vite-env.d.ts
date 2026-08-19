/// <reference types="vite/client" />

/**
 * Asset imports. vite.config.ts lists svg/csv under `assetsInclude`, so these
 * resolve to a URL string at build time.
 */
declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}
