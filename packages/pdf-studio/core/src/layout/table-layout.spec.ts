import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import type { TableElement } from '../model/elements';
import { layoutDocument } from '../render';
import { resolveColumnWidths } from './table-layout';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function withTable(table: TableElement, direction: 'ltr' | 'rtl' = 'ltr'): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      direction,
      locale: EN,
      unit: 'pt',
    },
    styles: [],
    datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
    parameters: [],
    bands: [
      { id: 'b', type: 'reportHeader', height: { mode: 'auto', min: 10 }, elements: [table] },
    ],
    resources: { fonts: [], images: [] },
  };
}

const table = (overrides: Partial<TableElement> = {}): TableElement => ({
  id: 'tbl',
  type: 'table',
  bounds: { x: 0, y: 0, width: 300, height: 20 },
  zIndex: 1,
  dataset: 'items',
  columns: [
    {
      id: 'name',
      width: { kind: 'percent', value: 60 },
      header: { text: 'Name' },
      detail: { content: { source: 'name' } },
    },
    {
      id: 'qty',
      width: { kind: 'fixed', value: 60 },
      header: { text: 'Qty' },
      detail: { content: { source: 'qty' } },
      footer: { aggregate: 'sum' },
    },
    {
      id: 'price',
      width: { kind: 'auto' },
      header: { text: 'Price' },
      detail: { content: { source: 'price' } },
      footer: { aggregate: 'sum' },
    },
  ],
  ...overrides,
});

const DATA = {
  items: [
    { name: 'A', qty: 2, price: 10 },
    { name: 'B', qty: 3, price: 5 },
  ],
};

describe('resolveColumnWidths', () => {
  it('distributes fixed/percent/auto across the table width', () => {
    const widths = resolveColumnWidths(table().columns, 300);
    // 60% of 300 = 180; fixed 60; auto gets the remaining 60.
    expect(widths).toEqual([180, 60, 60]);
  });

  it('splits the remainder evenly across multiple auto columns', () => {
    const widths = resolveColumnWidths(
      [
        { id: 'a', width: { kind: 'fixed', value: 100 } },
        { id: 'b', width: { kind: 'auto' } },
        { id: 'c', width: { kind: 'auto' } },
      ],
      300,
    );
    expect(widths).toEqual([100, 100, 100]);
  });
});

describe('table layout (§5, Phase 2)', () => {
  const cells = (t: PdfTemplate) =>
    layoutDocument(t, { data: DATA }).pages[0]!.elements.filter((e) => e.id.startsWith('tbl:'));

  it('emits header, one row per bound item, and an aggregate footer', () => {
    const els = cells(withTable(table()));
    const texts = els.map((e) => e.text);
    expect(texts).toEqual(expect.arrayContaining(['Name', 'Qty', 'Price', 'A', 'B']));
    // qty sum = 5, price sum = 15
    expect(texts).toEqual(expect.arrayContaining(['5', '15']));
  });

  it('positions header above detail above footer', () => {
    const els = cells(withTable(table()));
    const header = els.find((e) => e.id === 'tbl:h0')!;
    const firstRow = els.find((e) => e.id === 'tbl:r0c0')!;
    const footer = els.find((e) => e.id === 'tbl:f1')!;
    expect(header.bounds.y).toBeLessThan(firstRow.bounds.y);
    expect(firstRow.bounds.y).toBeLessThan(footer.bounds.y);
  });

  it('orders columns left-to-right for LTR', () => {
    const els = cells(withTable(table(), 'ltr'));
    const c0 = els.find((e) => e.id === 'tbl:h0')!; // name (60%)
    const c1 = els.find((e) => e.id === 'tbl:h1')!; // qty
    expect(c0.bounds.x).toBeLessThan(c1.bounds.x);
  });

  it('orders columns right-to-left for RTL (column 0 on the right)', () => {
    const els = cells(withTable(table(), 'rtl'));
    const c0 = els.find((e) => e.id === 'tbl:h0')!;
    const c1 = els.find((e) => e.id === 'tbl:h1')!;
    expect(c0.bounds.x).toBeGreaterThan(c1.bounds.x);
  });

  it('grows the table height with the number of rows', () => {
    const few = layoutDocument(withTable(table()), {
      data: { items: [{ name: 'A', qty: 1, price: 1 }] },
    });
    const many = layoutDocument(withTable(table()), {
      data: { items: Array.from({ length: 6 }, (_, i) => ({ name: `n${i}`, qty: i, price: i })) },
    });
    const maxY = (d: typeof few): number =>
      Math.max(
        ...d.pages[0]!.elements.filter((e) => e.id.startsWith('tbl:')).map((e) => e.bounds.y),
      );
    expect(maxY(many)).toBeGreaterThan(maxY(few));
  });

  it('computes min/max/avg/count aggregates and a literal footer', () => {
    const t = table({
      columns: [
        {
          id: 'name',
          width: { kind: 'auto' },
          footer: { text: 'Totals' },
          detail: { content: { source: 'name' } },
        },
        {
          id: 'min',
          width: { kind: 'auto' },
          detail: { content: { source: 'qty' } },
          footer: { aggregate: 'min' },
        },
        {
          id: 'max',
          width: { kind: 'auto' },
          detail: { content: { source: 'qty' } },
          footer: { aggregate: 'max' },
        },
        {
          id: 'avg',
          width: { kind: 'auto' },
          detail: { content: { source: 'price' } },
          footer: { aggregate: 'avg' },
        },
        {
          id: 'cnt',
          width: { kind: 'auto' },
          detail: { content: { source: 'qty' } },
          footer: { aggregate: 'count' },
        },
      ],
    });
    const els = layoutDocument(withTable(t), { data: DATA }).pages[0]!.elements;
    const footerTexts = els.filter((e) => /^tbl:f/.test(e.id)).map((e) => e.text);
    // qty=[2,3] → min 2, max 3, count 2; price=[10,5] → avg 7.5
    expect(footerTexts).toEqual(expect.arrayContaining(['Totals', '2', '3', '7.5']));
  });

  it('applies named cell styles and row striping', () => {
    const t = table({ rowStripeStyleId: 'stripe' });
    t.columns[0]!.header = { text: 'H', styleId: 'th' };
    const tpl = withTable(t);
    tpl.styles = [
      {
        id: 'th',
        name: 'TH',
        typography: { fontWeight: 'bold' },
        box: { fill: { color: { space: 'rgb', r: 1, g: 1, b: 1 } } },
      },
      {
        id: 'stripe',
        name: 'Stripe',
        box: { fill: { color: { space: 'rgb', r: 9, g: 9, b: 9 } } },
      },
    ];
    const els = layoutDocument(tpl, {
      data: {
        items: [
          { name: 'A', qty: 1, price: 1 },
          { name: 'B', qty: 2, price: 2 },
        ],
      },
    }).pages[0]!.elements;
    expect(els.find((e) => e.id === 'tbl:h0')!.box?.fill).toBeDefined();
    expect(els.find((e) => e.id === 'tbl:h0')!.typography?.fontWeight).toBe('bold');
    // odd detail row (index 1) gets the stripe fill
    expect(els.find((e) => e.id === 'tbl:r1c0')!.box?.fill).toBeDefined();
    expect(els.find((e) => e.id === 'tbl:r0c0')!.box?.fill).toBeUndefined();
  });

  it('renders a detail-only table (no header, no footer)', () => {
    const t = table({
      columns: [{ id: 'name', width: { kind: 'auto' }, detail: { content: { source: 'name' } } }],
    });
    const els = layoutDocument(withTable(t), { data: DATA }).pages[0]!.elements;
    expect(els.some((e) => /^tbl:h/.test(e.id))).toBe(false);
    expect(els.some((e) => /^tbl:f/.test(e.id))).toBe(false);
    expect(els.filter((e) => /^tbl:r/.test(e.id)).map((e) => e.text)).toEqual(['A', 'B']);
  });
});
