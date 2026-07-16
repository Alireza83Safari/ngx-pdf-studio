import { createRenderContext } from '../binding/render-context';
import type { Band } from '../model/band';
import type { DatasetDef } from '../model/dataset';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { paginate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const items: DatasetDef = { name: 'items', source: { kind: 'path', path: 'items' } };

const header = (id: string, text: string, master?: Band['master']): Band => ({
  id,
  type: 'pageHeader',
  height: { mode: 'fixed', value: 30 },
  ...(master ? { master } : {}),
  elements: [
    {
      id: `${id}-t`,
      type: 'staticText',
      bounds: { x: 0, y: 0, width: 200, height: 20 },
      zIndex: 1,
      text,
    },
  ],
});

// Tall detail rows so the data spans several pages.
const detail: Band = {
  id: 'd',
  type: 'detail',
  dataset: 'items',
  height: { mode: 'fixed', value: 350 },
  elements: [
    {
      id: 'row',
      type: 'dataField',
      bounds: { x: 0, y: 0, width: 100, height: 20 },
      zIndex: 1,
      value: { source: 'n' },
    },
  ],
};

function template(headers: Band[]): PdfTemplate {
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
    datasets: [items],
    parameters: [],
    bands: [...headers, detail],
    resources: { fonts: [], images: [] },
  };
}

const data = { items: [{ n: '1' }, { n: '2' }, { n: '3' }, { n: '4' }] }; // → multiple pages

const headerTextOnPage = (tpl: PdfTemplate, p: number): string | undefined => {
  const page = paginate(tpl, createRenderContext({ data })).pages[p];
  return page?.elements.find((e) => /-t$/.test(e.id))?.text;
};

describe('master pages (§11A-E)', () => {
  it('uses a first-page header on page 1 and the default elsewhere', () => {
    const tpl = template([header('first', 'FIRST', 'first'), header('rest', 'REST', 'all')]);
    const doc = paginate(tpl, createRenderContext({ data }));
    expect(doc.pageCount).toBeGreaterThan(1);
    expect(headerTextOnPage(tpl, 0)).toBe('FIRST'); // page 1 → first master
    expect(headerTextOnPage(tpl, 1)).toBe('REST'); // page 2 → default
  });

  it('alternates odd/even headers', () => {
    const tpl = template([header('o', 'ODD', 'odd'), header('e', 'EVEN', 'even')]);
    expect(headerTextOnPage(tpl, 0)).toBe('ODD'); // page 1 (odd)
    expect(headerTextOnPage(tpl, 1)).toBe('EVEN'); // page 2 (even)
  });

  it('prefers the most specific master (first beats odd on page 1)', () => {
    const tpl = template([header('o', 'ODD', 'odd'), header('f', 'FIRST', 'first')]);
    expect(headerTextOnPage(tpl, 0)).toBe('FIRST');
  });

  it('still works with a single default page header', () => {
    const tpl = template([header('h', 'H')]);
    expect(headerTextOnPage(tpl, 0)).toBe('H');
    expect(headerTextOnPage(tpl, 1)).toBe('H');
  });
});
