import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import type { FontInput } from '../paint/font-provider';
import { renderToPdf } from '../render';
import { extractPdfText } from './extract-pdf-text';

const VAZIR = join(__dirname, '../../../pdf/fonts/vazirmatn/Vazirmatn-Regular.ttf');
const suite = existsSync(VAZIR) ? describe : describe.skip;

const FA: LocaleSetup = { language: 'fa', digits: 'persian', calendar: 'jalali' };

const line = (
  id: string,
  text: string,
  y: number,
  extra: Record<string, unknown> = {},
): AnyElement =>
  ({
    id,
    type: 'staticText',
    bounds: { x: 0, y, width: 480, height: 20 },
    zIndex: 1,
    text,
    typography: { fontFamily: 'Vazirmatn', fontSize: 13 },
    ...extra,
  }) as AnyElement;

// The §11 mixed-language fixture in one document.
const fixture: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'i18n-golden' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 30, right: 30, bottom: 30, left: 30 },
    direction: 'rtl',
    locale: FA,
    unit: 'pt',
  },
  styles: [],
  datasets: [],
  parameters: [],
  bands: [
    {
      id: 'b',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 160 },
      elements: [
        line('fa', 'انبار مرکزی', 0),
        line('en', 'Central Warehouse', 28, { direction: 'ltr' }),
        line('mixed', 'مبلغ 1200 USD', 56),
        {
          id: 'date',
          type: 'dataField',
          bounds: { x: 0, y: 84, width: 480, height: 20 },
          zIndex: 1,
          typography: { fontFamily: 'Vazirmatn', fontSize: 13 },
          value: { source: 'now()' },
          format: { kind: 'date', options: { pattern: 'yyyy/MM/dd' } },
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

suite('§11 bilingual golden (text extraction, §13)', () => {
  const fonts: FontInput[] = [{ family: 'Vazirmatn', bytes: new Uint8Array(readFileSync(VAZIR)) }];

  it('produces selectable, extractable text containing both scripts and numbers', async () => {
    const result = await renderToPdf(
      fixture,
      { now: Date.parse('2026-06-24T00:00:00Z') },
      { pdf: { fonts } },
    );
    expect(result.diagnostics.filter((d) => /Could not render/.test(d.message))).toHaveLength(0);

    const text = (await extractPdfText(result.bytes)).join('\n');
    // English LTR content extracts verbatim.
    expect(text).toContain('Central Warehouse');
    expect(text).toContain('USD');
    // The Latin number survives within the RTL line.
    expect(text).toContain('1200');
    // Persian script is present and extractable (not rasterized).
    expect(/[؀-ۿ]/.test(text)).toBe(true);
    // The Jalali date for 2026-06-24 is 1405/04/03, in Persian digits, and must
    // read left-to-right (regression: fontkit reverses Arabic-script digit runs).
    expect(text).toContain('۱۴۰۵/۰۴/۰۳');
  }, 30000);

  it('extracted text is stable across renders (deterministic)', async () => {
    const opts = { now: Date.parse('2026-06-24T00:00:00Z') };
    const a = await renderToPdf(fixture, opts, { pdf: { fonts } });
    const b = await renderToPdf(fixture, opts, { pdf: { fonts } });
    expect(await extractPdfText(a.bytes)).toEqual(await extractPdfText(b.bytes));
  }, 30000);
});
