import { chartOps } from './chart-ops';
import type { LaidChart } from '../layout/page';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const column: LaidChart = {
  kind: 'column',
  categories: ['Q1', 'Q2', 'Q3'],
  series: [
    { name: 'Sales', values: [10, 40, 25] },
    { name: 'Target', values: [20, 30, 30] },
  ],
  showLegend: true,
};

const textsOf = (ops: ReturnType<typeof chartOps>) =>
  ops.filter((o) => o.op === 'text').map((o) => (o.op === 'text' ? o.text : ''));

describe('chart axis labels + legend (§5)', () => {
  it('emits centered category labels under the x-axis', () => {
    const ops = chartOps(column, 300, 150);
    const labels = ops.filter((o) => o.op === 'text' && o.align === 'middle');
    expect(labels.map((o) => (o.op === 'text' ? o.text : ''))).toEqual(['Q1', 'Q2', 'Q3']);
    // labels sit below the plot; the axis baseline is above them
    const baseline = ops.find((o) => o.op === 'line' && o.y1 === o.y2)!;
    for (const l of labels) {
      if (l.op === 'text' && baseline.op === 'line') expect(l.y).toBeGreaterThan(baseline.y1);
    }
  });

  it('emits a legend row (one swatch + name per series) when showLegend is set', () => {
    const ops = chartOps(column, 300, 150);
    expect(textsOf(ops)).toEqual(expect.arrayContaining(['Sales', 'Target']));
    // two small legend swatches precede the bars
    const swatches = ops.filter((o) => o.op === 'rect' && o.h === 7);
    expect(swatches.length).toBe(2);
  });

  it('omits the legend when showLegend is false', () => {
    const ops = chartOps({ ...column, showLegend: false }, 300, 150);
    expect(textsOf(ops)).not.toEqual(expect.arrayContaining(['Sales']));
    expect(textsOf(ops)).toEqual(expect.arrayContaining(['Q1'])); // axis labels stay
  });

  it('labels the y-axis maximum value', () => {
    expect(textsOf(chartOps(column, 300, 150))).toContain('40');
  });

  it('adds a category legend column for pie charts', () => {
    const pie: LaidChart = {
      kind: 'pie',
      categories: ['Alpha', 'Beta'],
      series: [{ values: [3, 1] }],
      showLegend: true,
    };
    const ops = chartOps(pie, 300, 150);
    expect(textsOf(ops)).toEqual(['Alpha', 'Beta']);
  });

  it('renders labels in the SVG and the PDF without diagnostics', async () => {
    const el: AnyElement = {
      id: 'c',
      type: 'chart',
      chartKind: 'column',
      dataset: 'rows',
      categories: { source: 'q' },
      series: [{ name: 'Sales', values: { source: 'v' } }],
      bounds: { x: 0, y: 0, width: 300, height: 150 },
      zIndex: 1,
    } as AnyElement;
    const template: PdfTemplate = {
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
      datasets: [{ name: 'rows', source: { kind: 'path', path: 'rows' } }],
      parameters: [],
      bands: [
        { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 170 }, elements: [el] },
      ],
      resources: { fonts: [], images: [] },
    };
    const input = {
      data: {
        rows: [
          { q: 'Q1', v: 10 },
          { q: 'Q2', v: 40 },
        ],
      },
    };
    const svg = renderToSvg(template, input).pages[0]!;
    expect(svg).toContain('>Q1</text>');
    expect(svg).toContain('text-anchor="middle"');

    const pdf = await renderToPdf(template, input);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.diagnostics).toHaveLength(0);
  });
});
