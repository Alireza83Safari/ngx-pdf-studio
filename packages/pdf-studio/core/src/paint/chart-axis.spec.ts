/**
 * The value axis (§5): before this, a cartesian chart drew a single label with
 * the raw maximum — the stray "905" on the dashboard — and no ticks, gridlines
 * or value labels, while `showLabels` sat in the model unread.
 */
import { axisTicks, chartOps } from './chart-ops';
import type { LaidChart } from '../layout/page';

const column: LaidChart = {
  kind: 'column',
  categories: ['Q1', 'Q2', 'Q3'],
  series: [{ name: 'Sales', values: [10, 40, 25] }],
  showLegend: false,
};

const texts = (ops: ReturnType<typeof chartOps>) =>
  ops.filter((o) => o.op === 'text').map((o) => (o.op === 'text' ? o.text : ''));
const gridlines = (ops: ReturnType<typeof chartOps>) =>
  ops.filter((o) => o.op === 'line' && o.width === 0.5);

describe('axisTicks', () => {
  it('lands on round numbers', () => {
    expect(axisTicks(40)).toEqual([0, 10, 20, 30, 40]);
    expect(axisTicks(8)).toEqual([0, 2, 4, 6, 8]);
  });

  it('covers the maximum, overshooting to the next round step when needed', () => {
    const ticks = axisTicks(905);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(905);
    expect(ticks).toEqual([0, 250, 500, 750, 1000]);
  });

  it('always starts at zero', () => {
    for (const max of [1, 7, 33, 1234, 0.4]) expect(axisTicks(max)[0]).toBe(0);
  });

  it('degrades safely for a non-positive maximum', () => {
    expect(axisTicks(0)).toEqual([0, 1]);
    expect(axisTicks(-5)).toEqual([0, 1]);
  });
});

describe('chart value axis (§5)', () => {
  it('labels every tick, not just the maximum', () => {
    const labels = texts(chartOps(column, 300, 150));
    expect(labels).toEqual(expect.arrayContaining(['0', '10', '20', '30', '40']));
  });

  it('draws a gridline per tick above the baseline', () => {
    // 5 ticks, but zero sits on the baseline rule itself
    expect(gridlines(chartOps(column, 300, 150))).toHaveLength(4);
  });

  it('scales to the top tick, so the tallest bar stops on a gridline', () => {
    const ops = chartOps({ ...column, series: [{ values: [905] }], categories: ['A'] }, 300, 150);
    const bar = ops.find((o) => o.op === 'rect')!;
    const top = gridlines(ops).map((o) => (o.op === 'line' ? o.y1 : 0));
    // 905 against a 1000 top tick: the bar does not reach the plot ceiling
    if (bar.op === 'rect') expect(bar.y).toBeGreaterThan(Math.min(...top));
  });

  it('writes axis labels in the document digits', () => {
    const labels = texts(chartOps({ ...column, digits: 'persian' }, 300, 150));
    expect(labels).toEqual(expect.arrayContaining(['۱۰', '۴۰']));
    expect(labels).not.toEqual(expect.arrayContaining(['10']));
  });

  it('turns the gridlines vertical for horizontal bars', () => {
    const ops = chartOps({ ...column, kind: 'bar' }, 300, 150);
    for (const g of gridlines(ops)) if (g.op === 'line') expect(g.x1).toBe(g.x2);
  });
});

describe('showLabels (§5)', () => {
  it('is off by default', () => {
    expect(texts(chartOps(column, 300, 150))).not.toEqual(expect.arrayContaining(['25']));
  });

  it('prints each point value above its column', () => {
    const ops = chartOps({ ...column, showLabels: true }, 300, 150);
    expect(texts(ops)).toEqual(expect.arrayContaining(['10', '40', '25']));
    const label = ops.find((o) => o.op === 'text' && o.text === '25')!;
    const bar = ops.filter((o) => o.op === 'rect')[2]!;
    if (label.op === 'text' && bar.op === 'rect') expect(label.y).toBeLessThan(bar.y);
  });

  it('labels line and scatter points too', () => {
    for (const kind of ['line', 'scatter'] as const) {
      const ops = chartOps({ ...column, kind, showLabels: true }, 300, 150);
      expect(texts(ops)).toEqual(expect.arrayContaining(['40']));
    }
  });

  it('prints each slice share on a pie, in the document digits', () => {
    const pie: LaidChart = {
      kind: 'pie',
      categories: ['A', 'B'],
      series: [{ values: [3, 1] }],
      showLegend: false,
      showLabels: true,
      digits: 'persian',
    };
    expect(texts(chartOps(pie, 300, 150))).toEqual(['۷۵%', '۲۵%']);
  });
});
