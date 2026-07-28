/**
 * The three chart kinds the model accepted but `chartOps` never implemented
 * (§5): `combo` (per-series shape), `scatter`, `sparkline`. Before this they all
 * fell through to the grouped-column branch and painted the wrong picture with
 * no diagnostic, and `ChartSeries.kind` was dropped in `resolveChart`.
 */
import { chartOps } from './chart-ops';
import type { LaidChart } from '../layout/page';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const base = {
  categories: ['Q1', 'Q2', 'Q3'],
  showLegend: false,
};
const bars = (ops: ReturnType<typeof chartOps>) => ops.filter((o) => o.op === 'rect');
const lines = (ops: ReturnType<typeof chartOps>) => ops.filter((o) => o.op === 'line');
const paths = (ops: ReturnType<typeof chartOps>) => ops.filter((o) => o.op === 'path');
/**
 * Series segments only. Axis rules (0.75) and gridlines (0.5) are drawn as lines
 * too, so counting every line would conflate the data with the furniture.
 */
const seriesLines = (ops: ReturnType<typeof chartOps>) =>
  ops.filter((o) => o.op === 'line' && o.width === 1.5);

describe('combo charts honour each series kind (§5)', () => {
  const combo: LaidChart = {
    ...base,
    kind: 'combo',
    series: [
      { name: 'Sales', values: [10, 40, 25], kind: 'column' },
      { name: 'Target', values: [20, 30, 30], kind: 'line' },
    ],
  };

  it('draws the column series as bars and the line series as segments', () => {
    const ops = chartOps(combo, 300, 150);
    // 3 bars for the column series…
    expect(bars(ops)).toHaveLength(3);
    // …and 2 segments joining the line series' 3 points
    expect(seriesLines(ops)).toHaveLength(2);
  });

  it('gives the columns the full category slot when only one series is a column', () => {
    const ops = chartOps(combo, 300, 150);
    const solo = bars(ops)[0]!;
    // one column slot of a 3-category, 300pt-wide plot: (300-16)/3 * 0.8
    const groupW = (300 - 16) / 3;
    if (solo.op === 'rect') expect(solo.w).toBeCloseTo(groupW * 0.8, 5);
  });

  it('shares one scale across mixed series, so the tallest value tops the plot', () => {
    const ops = chartOps(combo, 300, 150);
    const tallest = Math.min(...bars(ops).map((o) => (o.op === 'rect' ? o.y : Infinity)));
    // Sales' 40 is the overall max, so its bar tops the Target line's 30
    const lineTop = Math.min(
      ...seriesLines(ops).map((o) => (o.op === 'line' ? Math.min(o.y1, o.y2) : 0)),
    );
    expect(tallest).toBeLessThanOrEqual(lineTop + 0.01);
  });

  it('defaults a series with no kind to a column', () => {
    const ops = chartOps({ ...combo, series: [{ values: [1, 2, 3] }] }, 300, 150);
    expect(bars(ops)).toHaveLength(3);
    expect(seriesLines(ops)).toHaveLength(0);
  });

  it('supports an area series inside a combo', () => {
    const ops = chartOps({ ...combo, series: [{ values: [1, 2, 3], kind: 'area' }] }, 300, 150);
    expect(paths(ops)).toHaveLength(1);
  });
});

describe('scatter (§5)', () => {
  it('emits one mark per point instead of bars', () => {
    const ops = chartOps({ ...base, kind: 'scatter', series: [{ values: [5, 9, 2] }] }, 300, 150);
    const marks = bars(ops);
    expect(marks).toHaveLength(3);
    // marks are small squares, not full-height columns
    for (const m of marks) if (m.op === 'rect') expect(m.h).toBeLessThan(5);
  });
});

describe('sparkline (§5)', () => {
  const spark: LaidChart = { ...base, kind: 'sparkline', series: [{ values: [3, 8, 5, 9] }] };

  it('is a bare trend line — no axis rules, no labels, no legend', () => {
    const ops = chartOps({ ...spark, showLegend: true }, 120, 24);
    expect(ops.filter((o) => o.op === 'text')).toHaveLength(0);
    // 4 points → 3 segments, and nothing else
    expect(lines(ops)).toHaveLength(3);
    expect(ops).toHaveLength(3);
  });

  it('fills its box instead of reserving axis gutters', () => {
    const ops = chartOps(spark, 120, 24);
    const xs = ops.flatMap((o) => (o.op === 'line' ? [o.x1, o.x2] : []));
    expect(Math.min(...xs)).toBeLessThan(20);
    expect(Math.max(...xs)).toBeGreaterThan(100);
  });

  it('tolerates an empty series', () => {
    expect(chartOps({ ...spark, series: [{ values: [] }] }, 120, 24)).toEqual([]);
  });
});

describe('series kind survives layout and both painters (§5)', () => {
  const template: PdfTemplate = {
    schemaVersion: '1.0.0',
    metadata: { name: 'combo' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      direction: 'ltr',
      locale: EN,
      unit: 'pt',
    },
    styles: [],
    datasets: [{ name: 'rows', source: { kind: 'path', path: 'rows' } }],
    parameters: [],
    bands: [
      {
        id: 'b',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 170 },
        elements: [
          {
            id: 'c',
            type: 'chart',
            chartKind: 'combo',
            dataset: 'rows',
            categories: { source: 'q' },
            series: [
              { name: 'Sales', values: { source: 'v' }, kind: 'column' },
              { name: 'Target', values: { source: 't' }, kind: 'line' },
            ],
            bounds: { x: 0, y: 0, width: 300, height: 150 },
            zIndex: 1,
          } as AnyElement,
        ],
      },
    ],
    resources: { fonts: [], images: [] },
  };
  const input = {
    data: {
      rows: [
        { q: 'Q1', v: 10, t: 20 },
        { q: 'Q2', v: 40, t: 30 },
      ],
    },
  };

  it('renders both shapes in the SVG', () => {
    const svg = renderToSvg(template, input).pages[0]!;
    // the column series' bars…
    expect(svg).toContain('<rect');
    // …and the line series' segment, which a pure column chart would never emit
    // beyond the two axis rules
    const segments = svg.match(/<line /g) ?? [];
    expect(segments.length).toBeGreaterThan(2);
  });

  it('renders in the PDF without diagnostics', async () => {
    const pdf = await renderToPdf(template, input);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.diagnostics).toHaveLength(0);
  });
});
