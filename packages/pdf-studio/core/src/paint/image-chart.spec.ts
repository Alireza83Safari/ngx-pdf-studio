import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { ImageResource } from '../model/resource';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

// A valid 1×1 PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function template(elements: AnyElement[], images: ImageResource[] = []): PdfTemplate {
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
    datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
    parameters: [],
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 300 }, elements }],
    resources: { fonts: [], images },
  };
}

const imageEl = (extra: Partial<AnyElement> = {}): AnyElement =>
  ({
    id: 'img',
    type: 'image',
    bounds: { x: 0, y: 0, width: 80, height: 60 },
    zIndex: 1,
    ...extra,
  }) as AnyElement;

describe('image element (§5)', () => {
  it('resolves an embedded resource and embeds it in the PDF + SVG', async () => {
    const tpl = template(
      [imageEl({ resourceId: 'logo', fit: 'contain' })],
      [{ id: 'logo', mime: 'image/png', data: PNG_B64 }],
    );
    const el = layoutDocument(tpl).pages[0]!.elements.find((e) => e.id === 'img')!;
    expect(el.image).toMatchObject({ mime: 'image/png', fit: 'contain', base64: PNG_B64 });

    const svg = renderToSvg(tpl).pages[0]!;
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,');

    const pdf = await renderToPdf(tpl);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.diagnostics.filter((d) => /image/i.test(d.message))).toHaveLength(0);
  });

  it('resolves a data: URI from a dynamic source', () => {
    const tpl = template([imageEl({ source: { source: `'data:image/png;base64,${PNG_B64}'` } })]);
    const el = layoutDocument(tpl).pages[0]!.elements.find((e) => e.id === 'img')!;
    expect(el.image?.base64).toBe(PNG_B64);
  });

  it('treats a plain URL source as a URL image (SVG uses it; PDF warns)', async () => {
    const tpl = template([imageEl({ source: { source: "'https://example.com/x.png'" } })]);
    expect(renderToSvg(tpl).pages[0]).toContain('https://example.com/x.png');
    const pdf = await renderToPdf(tpl);
    expect(pdf.diagnostics.some((d) => /URL images are not embedded/.test(d.message))).toBe(true);
  });

  it('warns when a resource id is missing', () => {
    const doc = layoutDocument(template([imageEl({ resourceId: 'nope' })]));
    expect(doc.diagnostics.some((d) => /Image resource 'nope' not found/.test(d.message))).toBe(
      true,
    );
    expect(doc.pages[0]!.elements.find((e) => e.id === 'img')!.image).toBeUndefined();
  });

  it('maps fit=cover to a slice preserveAspectRatio', () => {
    const tpl = template(
      [imageEl({ resourceId: 'logo', fit: 'cover' })],
      [{ id: 'logo', mime: 'image/png', data: PNG_B64 }],
    );
    expect(renderToSvg(tpl).pages[0]).toContain('preserveAspectRatio="xMidYMid slice"');
  });
});

const chartEl = (chartKind: string): AnyElement =>
  ({
    id: 'chart',
    type: 'chart',
    bounds: { x: 0, y: 0, width: 240, height: 160 },
    zIndex: 1,
    chartKind,
    dataset: 'items',
    categories: { source: 'label' },
    series: [{ name: 'sales', values: { source: 'value' } }],
  }) as AnyElement;

const CHART_DATA = {
  items: [
    { label: 'Q1', value: 10 },
    { label: 'Q2', value: 25 },
    { label: 'Q3', value: 15 },
  ],
};

describe('chart element (§5, vector)', () => {
  it('resolves categories + series across the dataset', () => {
    const el = layoutDocument(template([chartEl('column')]), {
      data: CHART_DATA,
    }).pages[0]!.elements.find((e) => e.id === 'chart')!;
    expect(el.chart?.categories).toEqual(['Q1', 'Q2', 'Q3']);
    expect(el.chart?.series[0]?.values).toEqual([10, 25, 15]);
  });

  it('draws a column chart as bars + axes in SVG and renders in PDF', async () => {
    const tpl = template([chartEl('column')]);
    const svg = renderToSvg(tpl, { data: CHART_DATA }).pages[0]!;
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3); // 3 bars (+ maybe box)
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThanOrEqual(2); // 2 axes
    const pdf = await renderToPdf(tpl, { data: CHART_DATA });
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('draws a line chart as polyline segments', () => {
    const svg = renderToSvg(template([chartEl('line')]), { data: CHART_DATA }).pages[0]!;
    // 2 axes + 2 segments for 3 points.
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('draws a horizontal bar chart', () => {
    const svg = renderToSvg(template([chartEl('bar')]), { data: CHART_DATA }).pages[0]!;
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('draws pie and donut charts as vector paths in SVG + PDF', async () => {
    const pie = renderToSvg(template([chartEl('pie')]), { data: CHART_DATA }).pages[0]!;
    expect((pie.match(/<path/g) ?? []).length).toBe(3); // one slice per category
    const donut = renderToSvg(template([chartEl('donut')]), { data: CHART_DATA }).pages[0]!;
    expect(donut).toContain('<path');
    const pdf = await renderToPdf(template([chartEl('pie')]), { data: CHART_DATA });
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('draws stacked-column (rects) and area (path) charts', () => {
    const stacked = renderToSvg(template([chartEl('stackedColumn')]), { data: CHART_DATA })
      .pages[0]!;
    expect((stacked.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const area = renderToSvg(template([chartEl('area')]), { data: CHART_DATA }).pages[0]!;
    expect(area).toContain('<path');
  });

  it('draws a single full-circle slice with two arcs', () => {
    const single = { items: [{ label: 'all', value: 100 }] };
    const svg = renderToSvg(template([chartEl('pie')]), { data: single }).pages[0]!;
    const path = /<path[^>]*d="([^"]+)"/.exec(svg)?.[1] ?? '';
    expect((path.match(/A /g) ?? []).length).toBe(2); // full circle = two arcs
  });

  it('falls back to 1-based index labels when no category expression is set', () => {
    const el = chartEl('column');
    delete (el as { categories?: unknown }).categories;
    const chart = layoutDocument(template([el]), { data: CHART_DATA }).pages[0]!.elements.find(
      (e) => e.id === 'chart',
    )!.chart;
    expect(chart?.categories).toEqual(['1', '2', '3']);
  });
});
