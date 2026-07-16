import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const barcode: AnyElement = {
  id: 'bc',
  type: 'barcode',
  bounds: { x: 0, y: 0, width: 200, height: 50 },
  zIndex: 1,
  symbology: 'code39',
  value: { source: "'INV-2026'" },
};

function template(el: AnyElement): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
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
      { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 60 }, elements: [el] },
    ],
    resources: { fonts: [], images: [] },
  };
}

describe('barcode rendering (§5)', () => {
  it('lays out a barcode with encoded module bits', () => {
    const el = layoutDocument(template(barcode)).pages[0]!.elements.find((e) => e.id === 'bc')!;
    expect(el.barcode).toBeDefined();
    expect(el.barcode!.length).toBeGreaterThan(0);
    expect(el.barcode!.some((b) => b)).toBe(true);
  });

  it('draws barcode bars as <rect> in the SVG preview', () => {
    const svg = renderToSvg(template(barcode)).pages[0]!;
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(1);
  });

  it('renders a barcode into the PDF without errors', async () => {
    const result = await renderToPdf(template(barcode));
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe('%PDF-');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('warns (non-fatal) for an unregistered symbology', () => {
    const result = layoutDocument(template({ ...barcode, symbology: 'aztec' } as AnyElement));
    expect(result.diagnostics.some((d) => /symbology 'aztec'/.test(d.message))).toBe(true);
  });
});

describe('barcode human-readable text (showText, §5)', () => {
  const withText = { ...barcode, showText: true } as AnyElement;

  it('resolves barcodeText in layout when showText is set', () => {
    const el = layoutDocument(template(withText)).pages[0]!.elements.find((e) => e.id === 'bc')!;
    expect(el.barcodeText).toBe('INV-2026');
    const plain = layoutDocument(template(barcode)).pages[0]!.elements.find((e) => e.id === 'bc')!;
    expect(plain.barcodeText).toBeUndefined();
  });

  it('draws the value under shortened bars in the SVG preview', () => {
    const svg = renderToSvg(template(withText)).pages[0]!;
    expect(svg).toContain('INV-2026'); // human-readable line
    // bars are shortened to leave the reserved text strip (50 - 10 = 40).
    expect(svg).toContain('height="40"');
  });

  it('renders the text into the PDF without diagnostics', async () => {
    const result = await renderToPdf(template(withText));
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe('%PDF-');
    expect(result.diagnostics).toHaveLength(0);
  });
});
