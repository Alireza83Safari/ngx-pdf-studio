import jsQR from 'jsqr';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

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
      { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 200 }, elements: [el] },
    ],
    resources: { fonts: [], images: [] },
  };
}

const qrEl = (source: string): AnyElement =>
  ({
    id: 'qr',
    type: 'qrcode',
    bounds: { x: 0, y: 0, width: 120, height: 120 },
    zIndex: 1,
    value: { source },
  }) as AnyElement;

/** Rasterize a QR module matrix to RGBA pixels (with quiet zone) for jsQR. */
function rasterize(
  modules: boolean[][],
  scale = 5,
  quiet = 4,
): { data: Uint8ClampedArray; size: number } {
  const n = modules.length;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!(modules[r]?.[c] ?? false)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((quiet + r) * scale + dy) * size + ((quiet + c) * scale + dx);
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { data, size };
}

describe('QR code element (§5)', () => {
  it('encodes a scannable QR — verified by a jsQR decode round-trip', () => {
    const value = 'INV-1405-0042';
    const el = layoutDocument(template(qrEl(`'${value}'`))).pages[0]!.elements.find(
      (e) => e.id === 'qr',
    )!;
    expect(el.qr).toBeDefined();
    expect(el.qr!.count).toBeGreaterThan(0);

    const { data, size } = rasterize(el.qr!.modules);
    const decoded = jsQR(data, size, size);
    expect(decoded?.data).toBe(value);
  });

  it('binds the value from data', () => {
    const el = layoutDocument(template(qrEl('order.id')), {
      data: { order: { id: 'A-77' } },
    }).pages[0]!.elements.find((e) => e.id === 'qr')!;
    const { data, size } = rasterize(el.qr!.modules);
    expect(jsQR(data, size, size)?.data).toBe('A-77');
  });

  it('draws QR squares in SVG and renders in PDF', async () => {
    const tpl = template(qrEl("'hello'"));
    expect((renderToSvg(tpl).pages[0]!.match(/<rect/g) ?? []).length).toBeGreaterThan(5);
    const pdf = await renderToPdf(tpl);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('warns (non-fatal) on an empty value', () => {
    const doc = layoutDocument(template(qrEl("''")));
    expect(doc.diagnostics.some((d) => /QR code .* has no value/.test(d.message))).toBe(true);
    expect(doc.pages[0]!.elements.find((e) => e.id === 'qr')!.qr).toBeUndefined();
  });
});
