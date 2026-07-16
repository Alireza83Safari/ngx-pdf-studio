import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const linkText = (id: string, value: string, y: number, link: AnyElement['link']): AnyElement =>
  ({
    id,
    type: 'staticText',
    bounds: { x: 10, y, width: 180, height: 18 },
    zIndex: 1,
    text: value,
    ...(link ? { link } : {}),
  }) as AnyElement;

const fixture: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'links' },
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
      id: 'p1',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 60 },
      pageBreakAfter: true, // force a second page so the internal jump has a target
      elements: [
        linkText('ext', 'Visit example', 0, {
          kind: 'url',
          target: { source: "'https://example.com/x'" },
        }),
        linkText('int', 'Go to page 2', 30, { kind: 'page', target: { source: '2' } }),
      ],
    },
    {
      id: 'p2',
      type: 'detail',
      height: { mode: 'fixed', value: 40 },
      elements: [linkText('t2', 'page two', 0, undefined)],
    },
  ],
  resources: { fonts: [], images: [] },
};

describe('hyperlinks / link annotations (§11A-D)', () => {
  it('writes external URL and internal page-jump Link annotations (pdfjs getAnnotations)', async () => {
    const result = await renderToPdf(fixture);
    const pdf = await getDocument({ data: result.bytes, isEvalSupported: false }).promise;
    expect(pdf.numPages).toBe(2);

    const annots = await (await pdf.getPage(1)).getAnnotations();
    const links = annots.filter((a) => a.subtype === 'Link');
    expect(links.length).toBe(2);

    const external = links.find((a) => (a.url ?? a.unsafeUrl ?? '').includes('example.com'));
    expect(external).toBeDefined();

    const internal = links.find((a) => a.dest != null && !(a.url ?? a.unsafeUrl));
    expect(internal).toBeDefined();
  });

  it('emits no annotations when no element is linked', async () => {
    const plain: PdfTemplate = {
      ...fixture,
      bands: [
        {
          id: 'b',
          type: 'reportHeader',
          height: { mode: 'fixed', value: 40 },
          elements: [linkText('t', 'hi', 0, undefined)],
        },
      ],
    };
    const result = await renderToPdf(plain);
    const pdf = await getDocument({ data: result.bytes, isEvalSupported: false }).promise;
    const annots = await (await pdf.getPage(1)).getAnnotations();
    expect(annots.filter((a) => a.subtype === 'Link').length).toBe(0);
  });
});
