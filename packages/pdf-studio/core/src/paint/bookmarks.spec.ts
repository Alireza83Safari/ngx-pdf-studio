import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const text = (id: string, value: string, y: number, level?: number): AnyElement =>
  ({
    id,
    type: 'staticText',
    bounds: { x: 0, y, width: 200, height: 18 },
    zIndex: 1,
    text: value,
    ...(level !== undefined ? { bookmark: { level } } : {}),
  }) as AnyElement;

const fixture: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'outline' },
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
    {
      id: 'b',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 200 },
      elements: [
        text('ch', 'Chapter 1', 0, 0),
        text('a', 'Section A', 30, 1),
        text('b', 'Section B', 60, 1),
        text('plain', 'no bookmark', 90),
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

describe('PDF outline / bookmarks (§11A-D)', () => {
  it('collects bookmark entries in document order with levels', () => {
    const doc = layoutDocument(fixture);
    expect(doc.bookmarks.map((b) => `${b.level}:${b.title}`)).toEqual([
      '0:Chapter 1',
      '1:Section A',
      '1:Section B',
    ]);
  });

  it('writes a nested PDF outline (verified with pdfjs getOutline)', async () => {
    const result = await renderToPdf(fixture);
    const pdf = await getDocument({ data: result.bytes, isEvalSupported: false }).promise;
    const outline = await pdf.getOutline();
    expect(outline).not.toBeNull();
    expect(outline!.map((o) => o.title)).toEqual(['Chapter 1']);
    expect(outline![0]!.items.map((i) => i.title)).toEqual(['Section A', 'Section B']);
  });

  it('produces no outline when there are no bookmarks', async () => {
    const plain: PdfTemplate = {
      ...fixture,
      bands: [
        {
          id: 'b',
          type: 'reportHeader',
          height: { mode: 'fixed', value: 40 },
          elements: [text('t', 'hi', 0)],
        },
      ],
    };
    const result = await renderToPdf(plain);
    const pdf = await getDocument({ data: result.bytes, isEvalSupported: false }).promise;
    expect(await pdf.getOutline()).toBeNull();
  });
});
