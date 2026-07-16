import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { justifyLineWithKashida, kashidaPoints } from './kashida';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf } from '../render';

describe('kashidaPoints (ROADMAP ۱.۴)', () => {
  it('finds the last legal junction of each word', () => {
    // «سلام» — س و ل dual-join؛ آخرین اتصال مجاز قبل از حرف آخر است
    const points = kashidaPoints('سلام دنیا');
    expect(points.length).toBe(2); // یکی برای هر کلمه
    // نقطهٔ کلمهٔ اول باید قبل از «م» باشد (اتصال ا→م نامجاز، ل→ا مجاز)
    expect(points[0]).toBe('سلام'.indexOf('ل'));
  });

  it('skips words with no legal junction (right-joining-only letters)', () => {
    // «درد» — د به بعدی نمی‌چسبد؛ «او» هم همین‌طور
    expect(kashidaPoints('درد او')).toEqual([]);
  });

  it('returns no points for Latin text', () => {
    expect(kashidaPoints('hello world')).toEqual([]);
  });
});

describe('justifyLineWithKashida', () => {
  it('inserts tatweels at junctions to consume the deficit', () => {
    const out = justifyLineWithKashida('سلام دنیا', 30, 10);
    expect(out).toContain('ـ');
    expect((out.match(/ـ/g) || []).length).toBe(3); // 30 / 10
    // stripping the tatweels gives back the original line
    expect(out.replace(/ـ/g, '')).toBe('سلام دنیا');
  });

  it('distributes across words round-robin', () => {
    const out = justifyLineWithKashida('سلام دنیای بزرگ', 30, 10);
    // 3 tatweels over 3 words → one each
    const words = out.split(' ');
    expect(words.every((w) => (w.match(/ـ/g) || []).length === 1)).toBe(true);
  });

  it('leaves lines without junctions untouched', () => {
    expect(justifyLineWithKashida('hello world', 50, 10)).toBe('hello world');
    expect(justifyLineWithKashida('درد او', 50, 10)).toBe('درد او');
  });

  it('does nothing when there is no deficit', () => {
    expect(justifyLineWithKashida('سلام دنیا', 0, 10)).toBe('سلام دنیا');
    expect(justifyLineWithKashida('سلام دنیا', 5, 10)).toBe('سلام دنیا');
  });
});

// --- layout integration: align 'justify' stretches wrapped Persian text ---

const FA: LocaleSetup = { language: 'fa', digits: 'persian', calendar: 'jalali' };

function template(align: 'justify' | 'start'): PdfTemplate {
  const el: AnyElement = {
    id: 'p',
    type: 'staticText',
    bounds: { x: 0, y: 0, width: 160, height: 20 },
    zIndex: 1,
    // long enough to wrap into several lines at width 160
    text: 'متن نمونهٔ فارسی برای آزمون ترازبندی دوطرفه با کشیدهٔ تایپوگرافیک در سطرهای میانی سند',
    typography: { fontSize: 12, align },
  } as AnyElement;
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      direction: 'rtl',
      locale: FA,
      unit: 'pt',
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'auto' }, elements: [el] }],
    resources: { fonts: [], images: [] },
  };
}

describe("align: 'justify' in layout (§7 WYSIWYG)", () => {
  it('elongates every wrapped line except the last', () => {
    const doc = layoutDocument(template('justify'));
    const el = doc.pages[0]!.elements.find((e) => e.id === 'p')!;
    expect(el.lines!.length).toBeGreaterThan(2);
    const body = el.lines!.slice(0, -1);
    expect(body.every((l) => l.includes('ـ'))).toBe(true);
    expect(el.lines![el.lines!.length - 1]).not.toContain('ـ');
    // content is preserved — only tatweels were added
    expect(el.lines!.join(' ').replace(/ـ/g, '')).toBe(
      layoutDocument(template('start'))
        .pages[0]!.elements.find((e) => e.id === 'p')!
        .lines!.join(' '),
    );
  });

  it('renders the justified text to PDF without diagnostics', async () => {
    const vazir = join(__dirname, '../../../pdf/fonts/vazirmatn/Vazirmatn-Regular.ttf');
    const fonts = [{ family: 'Vazirmatn', bytes: new Uint8Array(readFileSync(vazir)) }];
    const tpl = template('justify');
    tpl.bands[0]!.elements[0]!.typography!.fontFamily = 'Vazirmatn';
    const result = await renderToPdf(tpl, {}, { pdf: { fonts } });
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe('%PDF-');
    expect(result.diagnostics).toHaveLength(0);
  });
});
