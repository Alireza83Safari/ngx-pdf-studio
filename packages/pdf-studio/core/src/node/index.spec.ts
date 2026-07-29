import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import {
  VAZIRMATN_FAMILY,
  loadBundledVazirmatn,
  loadFontFile,
  render,
  renderBatch,
  renderMerged,
  renderToFile,
} from './index';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

const TITLE: AnyElement = {
  id: 't',
  type: 'dataField',
  bounds: { x: 0, y: 0, width: 200, height: 24 },
  zIndex: 1,
  value: { source: 'name' },
};

const tpl: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'node-test' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    direction: 'ltr',
    locale: EN,
    unit: 'pt',
  },
  styles: [],
  datasets: [],
  parameters: [],
  bands: [
    { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 40 }, elements: [TITLE] },
  ],
  resources: { fonts: [], images: [] },
};

const isPdf = (bytes: Uint8Array): boolean =>
  new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';

describe('Node entry point (§3, §12)', () => {
  it('render() produces a real PDF in Node', async () => {
    const result = await render(tpl, { data: { name: 'Server' } });
    expect(isPdf(result.bytes)).toBe(true);
    expect(result.pageCount).toBe(1);
  });

  it('renderToFile writes the PDF to disk', async () => {
    const out = join(tmpdir(), `ngx-pdf-studio-node-${process.pid}.pdf`);
    try {
      await renderToFile(tpl, { data: { name: 'File' } }, out);
      expect(existsSync(out)).toBe(true);
      expect(isPdf(new Uint8Array(readFileSync(out)))).toBe(true);
    } finally {
      if (existsSync(out)) rmSync(out);
    }
  });

  it('renderBatch produces one PDF per record (mail-merge)', async () => {
    const results = await renderBatch(tpl, [
      { data: { name: 'a' } },
      { data: { name: 'b' } },
      { data: { name: 'c' } },
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => isPdf(r.bytes))).toBe(true);
  });

  it('renderMerged concatenates records into a single document', async () => {
    const merged = await renderMerged(tpl, [{ data: { name: 'a' } }, { data: { name: 'b' } }]);
    expect(isPdf(merged)).toBe(true);
    const loaded = await PDFDocument.load(merged);
    expect(loaded.getPageCount()).toBe(2);
  });

  const maybe = existsSync(DEJAVU) ? it : it.skip;
  maybe('loadFontFile reads font bytes for embedding', () => {
    const font = loadFontFile(DEJAVU, 'DejaVu Sans', { weight: 'bold' });
    expect(font.family).toBe('DejaVu Sans');
    expect(font.bytes.length).toBeGreaterThan(1000);
    expect(font.weight).toBe('bold');
  });
});

describe('end-to-end Persian + mixed-language rendering (§11)', () => {
  const fonts = loadBundledVazirmatn();

  const text = (id: string, value: string, extra: Record<string, unknown> = {}): AnyElement =>
    ({
      id,
      type: 'staticText',
      bounds: { x: 0, y: 0, width: 400, height: 20 },
      zIndex: 1,
      text: value,
      typography: { fontFamily: VAZIRMATN_FAMILY, fontSize: 14 },
      ...extra,
    }) as AnyElement;

  // One document mixing: a Persian RTL line, an English LTR line, and a line
  // that mixes Persian + an English word + a Latin number (the §11 scenario).
  const fixture: PdfTemplate = {
    ...tpl,
    page: {
      ...tpl.page,
      direction: 'rtl',
      locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
    },
    bands: [
      {
        id: 'b',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 120 },
        elements: [
          text('fa', 'انبار مرکزی — فاکتور فروش'),
          text('en', 'Central Warehouse — Sales Invoice', {
            direction: 'ltr',
            bounds: { x: 0, y: 24, width: 400, height: 20 },
          }),
          text('mixed', 'مبلغ کل 1,200 دلار (USD)', {
            bounds: { x: 0, y: 48, width: 400, height: 20 },
          }),
          {
            id: 'date',
            type: 'dataField',
            bounds: { x: 0, y: 72, width: 400, height: 20 },
            zIndex: 1,
            typography: { fontFamily: VAZIRMATN_FAMILY, fontSize: 14 },
            value: { source: 'now()' },
            format: { kind: 'date', options: { pattern: 'yyyy/MM/dd' } },
          },
        ],
      },
    ],
  };

  it('renders Persian + mixed text with Vazirmatn and no encode failures', async () => {
    const result = await render(
      fixture,
      { now: Date.parse('2026-06-24T00:00:00Z') },
      { pdf: { fonts } },
    );
    expect(isPdf(result.bytes)).toBe(true);
    expect(result.diagnostics.filter((d) => /Could not render/.test(d.message))).toHaveLength(0);
    expect(result.bytes.length).toBeGreaterThan(2000); // embedded font subset present
  }, 30000);

  it('is byte-deterministic for the bilingual fixture (§3)', async () => {
    const a = await render(
      fixture,
      { now: Date.parse('2026-06-24T00:00:00Z') },
      { pdf: { fonts } },
    );
    const b = await render(
      fixture,
      { now: Date.parse('2026-06-24T00:00:00Z') },
      { pdf: { fonts } },
    );
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    // 180s, not 60: this renders the bilingual fixture twice with real font
    // subsetting, and it runs alongside `golden-i18n.spec.ts` doing the same —
    // the two heaviest suites contending for the same cores. Observed 60s
    // overruns on a loaded developer machine (103-115s), so the cap is set well
    // clear of the worst case rather than at it. This measures determinism, not
    // speed: a slow pass is correct, a timeout is a false failure that would
    // abort a release.
  }, 180000);
});
