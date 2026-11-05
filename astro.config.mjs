import { defineConfig } from 'astro/config';

// Astro generates only the two HTML pages. Everything else (app.js, CSS, the
// service worker, fonts, images, JSON) stays a plain unhashed file in
// public/ and is copied to dist/ verbatim, so URLs and offline behaviour do
// not change. Scripts in pages are is:inline so nothing is bundled.
export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
  compressHTML: false,
  build: {
    format: 'directory',
    inlineStylesheets: 'never',
  },
});
