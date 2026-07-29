/**
 * Consumer tarball smoke test (§14A): pack the built core dist exactly as npm
 * would publish it, install the tarball into a pristine temp project, and use
 * it both ways — `require` the Node subpath to render a Persian PDF, then
 * `import` the main entry to render SVG. Proves the published artifact works
 * standalone: fonts inside, subpath export, and both halves of the dual
 * CommonJS/ESM package resolvable. Run `npm run build:core` first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'packages/pdf-studio/core/dist');
if (!existsSync(join(dist, 'index.js'))) {
  console.error('core dist missing — run `npm run build:core` first');
  process.exit(1);
}

// npm ships as `npm.cmd` on Windows, and since the CVE-2024-27980 fix Node
// refuses to spawn a `.cmd` without a shell — so Windows needs `shell: true`,
// which in turn means quoting arguments that contain whitespace (temp paths
// under a user profile routinely do). POSIX keeps the plain, unshelled call.
const isWindows = process.platform === 'win32';
const NPM = isWindows ? 'npm.cmd' : 'npm';
const npmArgs = (args) => (isWindows ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args);
const npmOpts = isWindows ? { shell: true } : {};
const npm = (args, opts = {}) => execFileSync(NPM, npmArgs(args), { ...npmOpts, ...opts });

const work = mkdtempSync(join(tmpdir(), 'pdf-studio-smoke-'));
try {
  const packOut = npm(['pack', dist, '--pack-destination', work], {
    encoding: 'utf8',
  });
  const tarball = join(work, packOut.trim().split('\n').pop());

  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'smoke-consumer', private: true, version: '0.0.0' }),
  );
  npm(['install', tarball, '--no-audit', '--no-fund'], { cwd: work });

  writeFileSync(
    join(work, 'consume.js'),
    `
const { renderToFile, loadBundledVazirmatn, VAZIRMATN_FAMILY } = require('@ngx-pdf-studio/core/node');
const template = {
  schemaVersion: '1.0.0',
  metadata: { name: 'tarball-smoke' },
  page: { size: 'A4', orientation: 'portrait', margins: { top: 20, right: 20, bottom: 20, left: 20 },
    direction: 'rtl', locale: { language: 'fa', digits: 'persian', calendar: 'jalali' }, unit: 'pt' },
  styles: [], datasets: [], parameters: [],
  bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 40 }, elements: [
    { id: 't', type: 'staticText', bounds: { x: 0, y: 0, width: 300, height: 20 }, zIndex: 1,
      text: 'فاکتور ۱۲۳ — tarball', typography: { fontFamily: VAZIRMATN_FAMILY } }
  ]}],
  resources: { fonts: [], images: [] },
};
(async () => {
  const r = await renderToFile(template, {}, 'out.pdf', { pdf: { fonts: loadBundledVazirmatn() } });
  if (r.pageCount !== 1 || r.diagnostics.length > 0) throw new Error('unexpected render result');
  const head = require('fs').readFileSync('out.pdf').slice(0, 5).toString();
  if (head !== '%PDF-') throw new Error('not a PDF: ' + head);
  console.log('tarball smoke OK — pages:', r.pageCount);
})().catch((e) => { console.error(e); process.exit(1); });
`,
  );
  execFileSync('node', ['consume.js'], { cwd: work, stdio: 'inherit' });
  const size = readFileSync(join(work, 'out.pdf')).length;

  // The other half of the dual package. `import { … }` alone would prove
  // nothing — Node happily reads named exports off a CommonJS module — so this
  // also asserts the specifier *resolves into* `esm/`. If the `import`
  // condition ever regresses to the CJS entry, the Angular bailout comes back
  // silently, and only this check would notice.
  writeFileSync(
    join(work, 'consume.mjs'),
    `
import { renderToSvg, validateTemplate } from '@ngx-pdf-studio/core';

const resolved = import.meta.resolve('@ngx-pdf-studio/core');
if (!/[/\\\\]esm[/\\\\]/.test(resolved)) {
  throw new Error('import condition did not resolve to the ESM build: ' + resolved);
}

const template = {
  schemaVersion: '1.0.0',
  metadata: { name: 'esm-smoke' },
  page: { size: 'A4', orientation: 'portrait', margins: { top: 20, right: 20, bottom: 20, left: 20 },
    direction: 'rtl', locale: { language: 'fa', digits: 'persian', calendar: 'jalali' }, unit: 'pt' },
  styles: [], datasets: [], parameters: [],
  bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 40 }, elements: [
    { id: 't', type: 'staticText', bounds: { x: 0, y: 0, width: 300, height: 20 }, zIndex: 1,
      text: 'فاکتور ۱۲۳ — esm' }
  ]}],
  resources: { fonts: [], images: [] },
};

const checked = validateTemplate(template);
if (!checked.success) {
  throw new Error('template did not validate through the ESM entry: ' + JSON.stringify(checked.issues));
}
const r = renderToSvg(template, {});
if (r.pageCount !== 1 || !r.pages[0].startsWith('<svg')) throw new Error('unexpected SVG result');
console.log('esm smoke OK — resolved', resolved.slice(resolved.indexOf('@ngx-pdf-studio')));
`,
  );
  execFileSync('node', ['consume.mjs'], { cwd: work, stdio: 'inherit' });

  console.log(`tarball smoke test passed (${size} bytes, CJS + ESM entries)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
