/**
 * Consumer tarball smoke test (§14A): pack the built core dist exactly as npm
 * would publish it, install the tarball into a pristine temp project, and
 * render a Persian PDF through the installed package — proving the published
 * artifact works standalone (fonts inside, CJS entry, subpath export).
 * Run `npm run build:core` first.
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

const work = mkdtempSync(join(tmpdir(), 'pdf-studio-smoke-'));
try {
  const packOut = execFileSync('npm', ['pack', dist, '--pack-destination', work], {
    encoding: 'utf8',
  });
  const tarball = join(work, packOut.trim().split('\n').pop());

  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'smoke-consumer', private: true, version: '0.0.0' }),
  );
  execFileSync('npm', ['install', tarball, '--no-audit', '--no-fund'], { cwd: work });

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
  console.log(`tarball smoke test passed (${size} bytes)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
