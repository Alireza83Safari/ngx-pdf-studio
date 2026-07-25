/**
 * Builds the standalone visual designer assets (no dev server needed):
 *  - engine.global.js : the framework-agnostic engine bundled for the browser
 *    (esbuild → IIFE global `PdfStudio`).
 *  - vazirmatn.js     : the bundled Vazirmatn TTF as base64 (window.VAZIRMATN_BASE64),
 *    so the in-browser "Download PDF" works from file:// without fetch/CORS.
 *
 * Run:  node apps/playground/designer/build.mjs   (or: npm run designer:build)
 * Then open apps/playground/designer/designer.html in a browser.
 */
import { build } from 'esbuild';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');

await build({
  entryPoints: [join(repoRoot, 'packages/pdf-studio/core/src/index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'PdfStudio',
  platform: 'browser',
  outfile: join(here, 'engine.global.js'),
  logLevel: 'warning',
});

const ttf = readFileSync(
  join(repoRoot, 'packages/pdf-studio/pdf/fonts/vazirmatn/Vazirmatn-Regular.ttf'),
);
writeFileSync(
  join(here, 'vazirmatn.js'),
  `window.VAZIRMATN_BASE64=${JSON.stringify(ttf.toString('base64'))};`,
);

// pdfjs (UMD → window.pdfjsLib) + its worker, for the "Clone Format" flow
// (F2.5). Copied from node_modules so the standalone page needs no fetch/CDN.
const pdfjsDir = join(repoRoot, 'node_modules/pdfjs-dist/build');
copyFileSync(join(pdfjsDir, 'pdf.min.js'), join(here, 'pdfjs.global.js'));
copyFileSync(join(pdfjsDir, 'pdf.worker.min.js'), join(here, 'pdf.worker.min.js'));

console.log('Built engine.global.js + vazirmatn.js + pdfjs.global.js + pdf.worker.min.js');
console.log('Open apps/playground/designer/designer.html in a browser.');
