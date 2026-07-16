import { createRenderContext } from '../binding/render-context';
import type { Band } from '../model/band';
import type { ColumnSetup } from '../model/page';
import type { DatasetDef } from '../model/dataset';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { paginate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const items: DatasetDef = { name: 'items', source: { kind: 'path', path: 'items' } };

const detail = (height: number, extra?: Partial<Band>): Band => ({
  id: 'd',
  type: 'detail',
  dataset: 'items',
  height: { mode: 'fixed', value: height },
  ...extra,
  elements: [
    {
      id: 'row',
      type: 'dataField',
      bounds: { x: 0, y: 0, width: 100, height: 18 },
      zIndex: 1,
      value: { source: 'n' },
    },
  ],
});

function template(bands: Band[], columns?: ColumnSetup): PdfTemplate {
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
      ...(columns ? { columns } : {}),
    },
    styles: [],
    datasets: [items],
    parameters: [],
    bands,
    resources: { fonts: [], images: [] },
  };
}

// A4 content height ≈ 842 - 40 = 802pt.
const rows = (n: number) => ({
  items: Array.from({ length: n }, (_, i) => ({ n: String(i + 1) })),
});

describe('explicit page breaks (§5)', () => {
  it('breaks after a band flagged pageBreakAfter', () => {
    // 2 short rows would fit one page, but pageBreakAfter forces each onto its own page.
    const doc = paginate(
      template([detail(40, { pageBreakAfter: true })]),
      createRenderContext({ data: rows(3) }),
    );
    expect(doc.pageCount).toBe(3);
  });

  it('breaks before a band flagged pageBreakBefore', () => {
    const header: Band = {
      id: 'rh',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 40 },
      elements: [
        {
          id: 't',
          type: 'staticText',
          bounds: { x: 0, y: 0, width: 100, height: 18 },
          zIndex: 1,
          text: 'hi',
        },
      ],
    };
    const doc = paginate(
      template([header, detail(40, { pageBreakBefore: true })]),
      createRenderContext({ data: rows(1) }),
    );
    expect(doc.pageCount).toBe(2); // header on p1, detail forced to p2
  });

  it('breaks on a contained pageBreak element', () => {
    const withBreak = detail(40);
    withBreak.elements = [
      ...withBreak.elements,
      { id: 'pb', type: 'pageBreak', bounds: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 1 },
    ];
    const doc = paginate(template([withBreak]), createRenderContext({ data: rows(2) }));
    expect(doc.pageCount).toBe(2);
  });
});

describe('multi-column flow (§5)', () => {
  it('fills both columns before starting a new page', () => {
    // 300pt rows: 2 fit per column (600 < 802), 4 fill 2 columns → 1 page for 4 rows.
    const doc = paginate(
      template([detail(300)], { count: 2, gap: 12 }),
      createRenderContext({ data: rows(4) }),
    );
    expect(doc.pageCount).toBe(1);
    // 5th row overflows both columns of page 1 → page 2.
    const doc2 = paginate(
      template([detail(300)], { count: 2, gap: 12 }),
      createRenderContext({ data: rows(5) }),
    );
    expect(doc2.pageCount).toBe(2);
  });

  it('places the second column to the right of the first', () => {
    const doc = paginate(
      template([detail(300)], { count: 2, gap: 20 }),
      createRenderContext({ data: rows(3) }),
    );
    const xs = doc.pages[0]!.elements.map((e) => e.bounds.x);
    const left = 20; // page margin
    const colWidth = (595 - 40 - 20) / 2; // A4 width 595 - margins - gap, /2
    expect(xs).toContain(left); // col 0
    expect(xs.some((x) => Math.abs(x - (left + colWidth + 20)) < 0.5)).toBe(true); // col 1
  });
});
