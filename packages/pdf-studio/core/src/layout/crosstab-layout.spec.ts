import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument } from '../render';

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
    datasets: [{ name: 'sales', source: { kind: 'path', path: 'sales' } }],
    parameters: [],
    bands: [
      { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 200 }, elements: [el] },
    ],
    resources: { fonts: [], images: [] },
  };
}

const crosstab = (showTotals = false): AnyElement =>
  ({
    id: 'ct',
    type: 'crosstab',
    bounds: { x: 0, y: 0, width: 400, height: 120 },
    zIndex: 1,
    dataset: 'sales',
    rowGroups: [{ source: 'region' }],
    columnGroups: [{ source: 'quarter' }],
    measures: [{ value: { source: 'amount' }, aggregate: 'sum', label: 'Sales' }],
    showTotals,
  }) as AnyElement;

// region × quarter sales
const DATA = {
  sales: [
    { region: 'North', quarter: 'Q1', amount: 10 },
    { region: 'North', quarter: 'Q2', amount: 20 },
    { region: 'South', quarter: 'Q1', amount: 5 },
    { region: 'South', quarter: 'Q1', amount: 3 }, // same cell → sum 8
    { region: 'South', quarter: 'Q2', amount: 7 },
  ],
};

const cellsById = (el: AnyElement): Map<string, string> => {
  const map = new Map<string, string>();
  for (const e of layoutDocument(template(el), { data: DATA }).pages[0]!.elements) {
    if (e.id.startsWith('ct:')) map.set(e.id, e.text ?? '');
  }
  return map;
};

describe('crosstab / pivot (§5)', () => {
  it('builds a row×column matrix with aggregated measures', () => {
    const c = cellsById(crosstab());
    // header: corner(label) + Q1 + Q2
    expect(c.get('ct:c0r0')).toBe('Sales');
    expect(c.get('ct:c1r0')).toBe('Q1');
    expect(c.get('ct:c2r0')).toBe('Q2');
    // row North: 10, 20
    expect(c.get('ct:c0r1')).toBe('North');
    expect(c.get('ct:c1r1')).toBe('10');
    expect(c.get('ct:c2r1')).toBe('20');
    // row South: Q1 = 5+3 = 8, Q2 = 7
    expect(c.get('ct:c0r2')).toBe('South');
    expect(c.get('ct:c1r2')).toBe('8');
    expect(c.get('ct:c2r2')).toBe('7');
  });

  it('adds row/column/grand totals when showTotals is set', () => {
    const c = cellsById(crosstab(true));
    // Total column header at index 3
    expect(c.get('ct:c3r0')).toBe('Total');
    // North row total = 30, South row total = 15
    expect(c.get('ct:c3r1')).toBe('30');
    expect(c.get('ct:c3r2')).toBe('15');
    // Totals row (r3): Q1 col total = 18, Q2 = 27, grand = 45
    expect(c.get('ct:c0r3')).toBe('Total');
    expect(c.get('ct:c1r3')).toBe('18');
    expect(c.get('ct:c2r3')).toBe('27');
    expect(c.get('ct:c3r3')).toBe('45');
  });

  it('warns when a row/column group or measure is missing', () => {
    const broken = { ...crosstab(), rowGroups: [] } as AnyElement;
    const doc = layoutDocument(template(broken), { data: DATA });
    expect(doc.diagnostics.some((d) => /Crosstab .* needs a row group/.test(d.message))).toBe(true);
  });
});
