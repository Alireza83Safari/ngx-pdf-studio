/**
 * Playground demo runner. Renders a bilingual Persian invoice to a real PDF and
 * an openable SVG preview (HTML) using the engine + bundled Vazirmatn.
 *
 * "Design" today = edit the emitted `output/template.json` / `output/data.json`
 * and re-run; the visual drag-and-drop designer (Phase 4 UI) is not built yet.
 *
 * Run:  npx ts-node --project apps/playground/tsconfig.json apps/playground/demo.ts
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deserializeTemplate,
  importTemplate,
  renderToSvg,
  serializeTemplate,
  type PdfTemplate,
} from '../../packages/pdf-studio/core/src';
import { loadBundledVazirmatn, renderToPdf } from '../../packages/pdf-studio/core/src/node';
import { invoiceTemplate, sampleData } from './invoice-template';

const OUT = join(__dirname, 'output');
const TEMPLATE_JSON = join(OUT, 'template.json');
const DATA_JSON = join(OUT, 'data.json');
const FONT_SRC = join(
  __dirname,
  '../../packages/pdf-studio/pdf/fonts/vazirmatn/Vazirmatn-Regular.ttf',
);

function loadOrSeed(): { template: PdfTemplate; data: Record<string, unknown> } {
  mkdirSync(OUT, { recursive: true });

  if (existsSync(TEMPLATE_JSON) && existsSync(DATA_JSON)) {
    const result = importTemplate(readFileSync(TEMPLATE_JSON, 'utf8'));
    if (!result.success) {
      console.error('template.json is invalid:');
      for (const issue of result.issues) console.error(`  - ${issue.path}: ${issue.message}`);
      process.exit(1);
    }
    console.log('Using your edited template.json + data.json');
    return { template: result.value, data: JSON.parse(readFileSync(DATA_JSON, 'utf8')) };
  }

  // First run: seed the editable files from the built-in sample.
  writeFileSync(TEMPLATE_JSON, serializeTemplate(invoiceTemplate, { indent: 2 }));
  writeFileSync(DATA_JSON, JSON.stringify(sampleData, null, 2));
  console.log('Seeded output/template.json + output/data.json (edit them and re-run to redesign)');
  // Round-trip through JSON so the demo path matches what consumers do.
  return { template: deserializeTemplate(serializeTemplate(invoiceTemplate)), data: sampleData };
}

function buildPreviewHtml(svgPages: string[]): string {
  const fontFace = `@font-face{font-family:'Vazirmatn';src:url('./Vazirmatn-Regular.ttf') format('truetype');}`;
  const pages = svgPages.map((svg) => `<div class="page">${svg}</div>`).join('\n');
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><title>ngx-pdf-studio — preview</title>
<style>
  ${fontFace}
  body{margin:0;background:#eef2f7;font-family:'Vazirmatn',system-ui,sans-serif;}
  header{padding:16px 24px;background:#fff;border-bottom:1px solid #e2e8f0;}
  header h1{margin:0;font-size:16px;color:#1e293b;}
  header p{margin:4px 0 0;font-size:12px;color:#64748b;}
  .pages{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px;}
  .page{background:#fff;box-shadow:0 6px 24px rgba(15,23,42,.12);}
  .page svg{display:block;}
</style></head>
<body>
  <header><h1>ngx-pdf-studio — پیش‌نمایش زنده</h1>
  <p>این پیش‌نمایش SVG است (همان درخت چیدمانی که PDF از آن ساخته می‌شود). برای فایل نهایی، invoice.pdf را باز کنید.</p></header>
  <div class="pages">${pages}</div>
</body></html>`;
}

async function main(): Promise<void> {
  const { template, data } = loadOrSeed();

  const svg = renderToSvg(template, { data });
  if (existsSync(FONT_SRC)) copyFileSync(FONT_SRC, join(OUT, 'Vazirmatn-Regular.ttf'));
  writeFileSync(join(OUT, 'preview.html'), buildPreviewHtml(svg.pages));

  const pdf = await renderToPdf(
    template,
    { data, now: Date.now() },
    { pdf: { fonts: loadBundledVazirmatn(), metadata: { title: template.metadata.name } } },
  );
  writeFileSync(join(OUT, 'invoice.pdf'), pdf.bytes);

  console.log(`\nRendered ${pdf.pageCount} page(s).`);
  if (pdf.diagnostics.length) {
    console.log('Diagnostics:');
    for (const d of pdf.diagnostics) console.log(`  [${d.severity}] ${d.message}`);
  }
  console.log('\nOpen these:');
  console.log(`  • ${join(OUT, 'preview.html')}   (in a browser)`);
  console.log(`  • ${join(OUT, 'invoice.pdf')}     (in any PDF viewer)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
