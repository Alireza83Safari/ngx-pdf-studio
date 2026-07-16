import { createRenderContext } from '../binding/render-context';
import { Scope } from '../expression/scope';
import type { Band } from '../model/band';
import type { DatasetDef } from '../model/dataset';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import type { VariableDef } from '../model/variable';
import { paginate } from './paginate';
import { computeRowVariables } from './report-variables';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const rootScope = () => Scope.create({ data: {} });

const rows = [
  { cat: 'A', amt: 10 },
  { cat: 'A', amt: 20 },
  { cat: 'B', amt: 5 },
];

const catGroup: Band = {
  id: 'gh',
  type: 'groupHeader',
  groupLevel: 0,
  groupKey: { source: 'cat' },
  height: { mode: 'fixed', value: 10 },
  elements: [],
};

describe('computeRowVariables (§11A-D)', () => {
  it('accumulates a report-scoped running total across all rows', () => {
    const def: VariableDef = { name: 'rt', expression: { source: 'amt' }, calculation: 'sum' };
    const ctx = createRenderContext({ data: {} });
    const map = computeRowVariables([def], rows, [], rootScope(), ctx, 'latn');
    expect(rows.map((r) => map.get(r)!['rt'])).toEqual([10, 30, 35]);
  });

  it('resets a group-scoped variable when the group key changes', () => {
    const def: VariableDef = {
      name: 'ct',
      expression: { source: 'amt' },
      calculation: 'sum',
      reset: 'group',
      resetGroupLevel: 0,
    };
    const ctx = createRenderContext({ data: {} });
    const map = computeRowVariables([def], rows, [catGroup], rootScope(), ctx, 'latn');
    expect(rows.map((r) => map.get(r)!['ct'])).toEqual([10, 30, 5]); // A:10,30 ; B resets to 5
  });

  it('supports count / avg / min / max / first / last', () => {
    const defs: VariableDef[] = [
      { name: 'c', expression: { source: 'amt' }, calculation: 'count' },
      { name: 'a', expression: { source: 'amt' }, calculation: 'avg' },
      { name: 'mn', expression: { source: 'amt' }, calculation: 'min' },
      { name: 'mx', expression: { source: 'amt' }, calculation: 'max' },
      { name: 'f', expression: { source: 'cat' }, calculation: 'first' },
      { name: 'l', expression: { source: 'cat' }, calculation: 'last' },
    ];
    const ctx = createRenderContext({ data: {} });
    const last = rows[2]!;
    const snap = computeRowVariables(defs, rows, [], rootScope(), ctx, 'latn').get(last)!;
    expect(snap).toEqual({ c: 3, a: 35 / 3, mn: 5, mx: 20, f: 'A', l: 'B' });
  });

  it("warns and falls back to report scope for reset 'page'", () => {
    const def: VariableDef = {
      name: 'p',
      expression: { source: 'amt' },
      calculation: 'sum',
      reset: 'page',
    };
    const ctx = createRenderContext({ data: {} });
    const map = computeRowVariables([def], rows, [], rootScope(), ctx, 'latn');
    expect(map.get(rows[2]!)!['p']).toBe(35); // accumulates as 'report'
    expect(ctx.diagnostics.some((d) => /reset 'page'/.test(d.message))).toBe(true);
  });
});

// --- integration: $vars exposed to detail and group-footer expressions ---

const items: DatasetDef = { name: 'items', source: { kind: 'path', path: 'items' } };

function template(): PdfTemplate {
  const field = (id: string, expr: string): Band['elements'][number] => ({
    id,
    type: 'dataField',
    bounds: { x: 0, y: 0, width: 80, height: 16 },
    zIndex: 1,
    value: { source: expr },
  });
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
    variables: [
      { name: 'runningTotal', expression: { source: 'amt' }, calculation: 'sum' },
      {
        name: 'catTotal',
        expression: { source: 'amt' },
        calculation: 'sum',
        reset: 'group',
        resetGroupLevel: 0,
      },
    ],
    bands: [
      catGroup,
      {
        id: 'd',
        type: 'detail',
        dataset: 'items',
        height: { mode: 'fixed', value: 16 },
        elements: [field('rt', '$vars.runningTotal'), field('ct', '$vars.catTotal')],
      },
      {
        id: 'gf',
        type: 'groupFooter',
        groupLevel: 0,
        height: { mode: 'fixed', value: 16 },
        elements: [field('subtotal', '$vars.catTotal')],
      },
    ],
    resources: { fonts: [], images: [] },
  };
}

describe('report variables in pagination ($vars, §11A-D)', () => {
  it('exposes running totals to detail rows and group subtotals to footers', () => {
    const doc = paginate(template(), createRenderContext({ data: { items: rows } }));
    const texts = doc.pages[0]!.elements.filter((e) => e.text !== undefined).map((e) => e.text);
    // running totals 10,30,35 appear on detail rows; cat subtotals 30 (A) and 5 (B) in footers.
    expect(texts).toEqual(expect.arrayContaining(['10', '30', '35', '5']));
    // group A footer subtotal is 30, group B footer subtotal is 5.
    const footerVals = doc.pages[0]!.elements.filter((e) => e.id === 'subtotal').map((e) => e.text);
    expect(footerVals).toEqual(['30', '5']);
  });
});
