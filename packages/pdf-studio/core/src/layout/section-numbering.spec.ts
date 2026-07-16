import { createRenderContext } from '../binding/render-context';
import type { Band } from '../model/band';
import type { LocaleSetup } from '../model/locale';
import type { PageSetup } from '../model/page';
import type { PdfTemplate, TemplateSection } from '../model/template';
import { paginate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const PAGE: PageSetup = {
  size: 'A4',
  orientation: 'portrait',
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  direction: 'ltr',
  locale: EN,
  unit: 'pt',
};

// A footer that prints $page / $pageCount on every page (resolved per page).
const footer = (): Band => ({
  id: 'foot',
  type: 'pageFooter',
  height: { mode: 'fixed', value: 20 },
  elements: [
    {
      id: 'pp',
      type: 'pageField',
      field: 'page',
      bounds: { x: 0, y: 0, width: 80, height: 16 },
      zIndex: 1,
    },
    {
      id: 'cc',
      type: 'pageField',
      field: 'pageCount',
      bounds: { x: 100, y: 0, width: 80, height: 16 },
      zIndex: 1,
    },
  ],
});

// A tall body band that breaks after itself; N of them ⇒ N pages in a section.
const tall = (id: string): Band => ({
  id,
  type: 'detail',
  height: { mode: 'fixed', value: 760 },
  pageBreakAfter: true,
  elements: [],
});

const section = (id: string, n: number, restart?: boolean): TemplateSection => ({
  id,
  page: PAGE,
  bands: [footer(), ...Array.from({ length: n }, (_, i) => tall(`${id}-${i}`))],
  ...(restart ? { restartPageNumbers: true } : {}),
});

function template(sections: TemplateSection[]): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
    page: PAGE,
    styles: [],
    datasets: [],
    parameters: [],
    bands: [],
    sections,
    resources: { fonts: [], images: [] },
  };
}

const pageFields = (doc: ReturnType<typeof paginate>) =>
  doc.pages.map((p) => ({
    index: p.index,
    number: p.number,
    page: p.elements.find((e) => e.id === 'pp')?.text,
    count: p.elements.find((e) => e.id === 'cc')?.text,
  }));

describe('per-section page numbering (§11A-E)', () => {
  it('restarts $page and scopes $pageCount per numbering group', () => {
    // Section A: 2 pages, Section B restarts: 2 pages.
    const doc = paginate(
      template([section('a', 2), section('b', 2, true)]),
      createRenderContext({ data: {} }),
    );
    expect(doc.pageCount).toBe(4); // global physical count
    const fields = pageFields(doc);
    // Physical indices stay absolute 0..3.
    expect(fields.map((f) => f.index)).toEqual([0, 1, 2, 3]);
    // $page restarts at section B; $pageCount is per group (2 and 2).
    expect(fields.map((f) => f.page)).toEqual(['1', '2', '1', '2']);
    expect(fields.map((f) => f.count)).toEqual(['2', '2', '2', '2']);
  });

  it('keeps continuous numbering when no section restarts', () => {
    const doc = paginate(
      template([section('a', 2), section('b', 2)]),
      createRenderContext({ data: {} }),
    );
    const fields = pageFields(doc);
    expect(fields.map((f) => f.page)).toEqual(['1', '2', '3', '4']);
    expect(fields.map((f) => f.count)).toEqual(['4', '4', '4', '4']);
  });
});
