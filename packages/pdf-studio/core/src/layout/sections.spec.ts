import { createRenderContext } from '../binding/render-context';
import type { Band } from '../model/band';
import type { LocaleSetup } from '../model/locale';
import type { PageSetup } from '../model/page';
import type { PdfTemplate, TemplateSection } from '../model/template';
import { paginate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const pageSetup = (size: PageSetup['size'], orientation: PageSetup['orientation']): PageSetup => ({
  size,
  orientation,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  direction: 'ltr',
  locale: EN,
  unit: 'pt',
});

const header = (text: string): Band => ({
  id: 'h',
  type: 'reportHeader',
  height: { mode: 'fixed', value: 40 },
  elements: [
    {
      id: 't',
      type: 'staticText',
      bounds: { x: 0, y: 0, width: 200, height: 20 },
      zIndex: 1,
      text,
    },
  ],
});

const footerPageCount = (): Band => ({
  id: 'f',
  type: 'pageFooter',
  height: { mode: 'fixed', value: 20 },
  elements: [
    {
      id: 'pg',
      type: 'pageField',
      bounds: { x: 0, y: 0, width: 80, height: 16 },
      zIndex: 1,
      field: 'page',
    },
    {
      id: 'pc',
      type: 'pageField',
      bounds: { x: 90, y: 0, width: 80, height: 16 },
      zIndex: 1,
      field: 'pageCount',
    },
  ],
});

function template(sections: TemplateSection[]): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
    page: pageSetup('A4', 'portrait'),
    styles: [],
    datasets: [],
    parameters: [],
    bands: [],
    sections,
    resources: { fonts: [], images: [] },
  };
}

describe('sections with independent page setup (§11A-E)', () => {
  it('renders each section with its own page size/orientation, continuous numbering', () => {
    const doc = paginate(
      template([
        {
          id: 's1',
          page: pageSetup('A4', 'portrait'),
          bands: [header('Section 1'), footerPageCount()],
        },
        {
          id: 's2',
          page: pageSetup('A5', 'landscape'),
          bands: [header('Section 2'), footerPageCount()],
        },
      ]),
      createRenderContext({ data: {} }),
    );

    expect(doc.pageCount).toBe(2);
    // Page 1: A4 portrait (taller than wide).
    expect(doc.pages[0]!.size.height).toBeGreaterThan(doc.pages[0]!.size.width);
    // Page 2: A5 landscape (wider than tall), and smaller than A4.
    expect(doc.pages[1]!.size.width).toBeGreaterThan(doc.pages[1]!.size.height);
    expect(doc.pages[1]!.size.width).toBeLessThan(doc.pages[0]!.size.height);

    expect(doc.pages[0]!.elements.find((e) => e.id === 't')!.text).toBe('Section 1');
    expect(doc.pages[1]!.elements.find((e) => e.id === 't')!.text).toBe('Section 2');
  });

  it('uses continuous global $page and a document-wide $pageCount', () => {
    const doc = paginate(
      template([
        { id: 's1', page: pageSetup('A4', 'portrait'), bands: [footerPageCount()] },
        { id: 's2', page: pageSetup('A4', 'portrait'), bands: [footerPageCount()] },
      ]),
      createRenderContext({ data: {} }),
    );
    const pageNo = (p: number): string | undefined =>
      doc.pages[p]!.elements.find((e) => e.id === 'pg')!.text;
    const count = (p: number): string | undefined =>
      doc.pages[p]!.elements.find((e) => e.id === 'pc')!.text;
    expect([pageNo(0), pageNo(1)]).toEqual(['1', '2']);
    expect([count(0), count(1)]).toEqual(['2', '2']); // global count on every page
  });

  it('falls back to top-level page+bands when no sections are declared', () => {
    const tpl: PdfTemplate = {
      schemaVersion: '1.0.0',
      metadata: { name: 't' },
      page: pageSetup('A4', 'portrait'),
      styles: [],
      datasets: [],
      parameters: [],
      bands: [header('Plain')],
      resources: { fonts: [], images: [] },
    };
    const doc = paginate(tpl, createRenderContext({ data: {} }));
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0]!.elements.find((e) => e.id === 't')!.text).toBe('Plain');
  });
});
