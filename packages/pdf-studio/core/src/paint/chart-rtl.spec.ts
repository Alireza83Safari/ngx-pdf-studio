/**
 * Right-to-left charts (§5, §7). Categories used to run left-to-right on every
 * page, and the legend advance was a Latin-calibrated character count that
 * Persian labels overflowed onto their own swatch.
 */
import { chartOps } from './chart-ops';
import { CHART_LABEL_SIZE } from '../layout/chart-resolve';
import type { LaidChart } from '../layout/page';

const cats = ['Q1', 'Q2', 'Q3'];
const values = [10, 40, 25];

const ltr: LaidChart = {
  kind: 'column',
  categories: cats,
  series: [{ name: 'Sales', values }],
  showLegend: true,
};
const rtl: LaidChart = { ...ltr, rtl: true };

const texts = (ops: ReturnType<typeof chartOps>) => ops.filter((o) => o.op === 'text');
const labelX = (ops: ReturnType<typeof chartOps>, text: string): number => {
  const op = texts(ops).find((o) => o.op === 'text' && o.text === text);
  return op && op.op === 'text' ? op.x : NaN;
};
const bars = (ops: ReturnType<typeof chartOps>) => ops.filter((o) => o.op === 'rect');

describe('RTL cartesian charts (§7)', () => {
  it('runs categories right-to-left, mirroring the LTR order', () => {
    const l = chartOps(ltr, 300, 150);
    const r = chartOps(rtl, 300, 150);
    expect(labelX(l, 'Q1')).toBeLessThan(labelX(l, 'Q3'));
    expect(labelX(r, 'Q1')).toBeGreaterThan(labelX(r, 'Q3'));
    // and the mirror is exact: Q1's RTL slot is Q3's LTR slot
    expect(labelX(r, 'Q1')).toBeCloseTo(labelX(l, 'Q3'), 5);
  });

  it('moves the bars with their categories, not just the labels', () => {
    const first = (c: LaidChart): number => bars(chartOps(c, 300, 150))[0]!.x;
    // the tallest-value bar (Q2) stays in the middle, but Q1's bar flips sides
    expect(first(rtl)).toBeGreaterThan(first(ltr));
  });

  it('puts the value axis and its max label on the right', () => {
    const ops = chartOps(rtl, 300, 150);
    const verticals = ops.filter((o) => o.op === 'line' && o.x1 === o.x2);
    expect(verticals).toHaveLength(1);
    const axis = verticals[0]!;
    if (axis.op === 'line') {
      expect(axis.x1).toBeCloseTo(300 - 8, 5); // plot right edge
      expect(labelX(ops, '40')).toBeLessThanOrEqual(axis.x1);
    }
  });

  it('grows horizontal bars from the right', () => {
    const bar: LaidChart = { ...rtl, kind: 'bar' };
    const b = bars(chartOps(bar, 300, 150));
    // every bar ends flush against the right edge of the plot
    for (const o of b) if (o.op === 'rect') expect(o.x + o.w).toBeCloseTo(300 - 8, 5);
  });

  it('lays the legend out from the right', () => {
    const two: LaidChart = {
      ...rtl,
      series: [
        { name: 'Sales', values },
        { name: 'Target', values },
      ],
    };
    const ops = chartOps(two, 300, 150);
    expect(labelX(ops, 'Sales')).toBeGreaterThan(labelX(ops, 'Target'));
  });
});

describe('legend sizing uses measured widths (§5)', () => {
  const wide = 'یک عنوان بسیار طولانی برای راهنما';

  it('advances by the measured width instead of a character count', () => {
    const measured = 90; // what a real font reports, vs 33 chars * 7.5 * 0.62 ≈ 153
    const withMeasure = chartOps(
      {
        kind: 'column',
        categories: cats,
        showLegend: true,
        series: [
          { name: wide, values },
          { name: 'B', values },
        ],
        seriesNameWidths: [measured, 6],
      },
      400,
      150,
    );
    const gap = labelX(withMeasure, 'B') - labelX(withMeasure, wide);
    // swatch + gap + measured width + entry gap — not the character estimate
    expect(gap).toBeCloseTo(7 + 3 + measured + 12, 5);
  });

  it('falls back to the character estimate for a hand-built LaidChart', () => {
    const ops = chartOps(
      {
        kind: 'column',
        categories: cats,
        showLegend: true,
        series: [
          { name: 'AB', values },
          { name: 'C', values },
        ],
      },
      400,
      150,
    );
    const gap = labelX(ops, 'C') - labelX(ops, 'AB');
    expect(gap).toBeCloseTo(7 + 3 + 2 * CHART_LABEL_SIZE * 0.62 + 12, 5);
  });

  it('sizes the pie legend column from measured widths and flips it under RTL', () => {
    const pie: LaidChart = {
      kind: 'pie',
      categories: ['الف', 'ب'],
      series: [{ values: [3, 1] }],
      showLegend: true,
      categoryWidths: [40, 10],
    };
    const l = chartOps(pie, 300, 150);
    const r = chartOps({ ...pie, rtl: true }, 300, 150);
    // legend hugs the right under LTR and the left under RTL
    expect(labelX(l, 'الف')).toBeGreaterThan(150);
    expect(labelX(r, 'الف')).toBeLessThan(150);
  });
});
