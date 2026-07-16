import { paintToSvg } from '../paint/svg-painter';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf } from '../render';
import { ElementRegistry, type CustomElementRenderer } from './element-registry';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

// A toy "gauge": a track rect plus a fill rect proportional to value/max.
const gauge: CustomElementRenderer = ({ value, options, width, height }) => {
  const max = Number(options['max'] ?? 100);
  const frac = Math.max(0, Math.min(1, Number(value) / max));
  return [
    { op: 'rect', x: 0, y: 0, w: width, h: height, fill: { r: 0.9, g: 0.9, b: 0.9 } },
    { op: 'rect', x: 0, y: 0, w: width * frac, h: height, fill: { r: 0.1, g: 0.5, b: 0.9 } },
    { op: 'line', x1: 0, y1: height, x2: width, y2: height, color: { r: 0, g: 0, b: 0 }, width: 1 },
  ];
};

const el: AnyElement = {
  id: 'g',
  type: 'custom',
  renderer: 'gauge',
  value: { source: 'score' },
  options: { max: 200 },
  bounds: { x: 10, y: 0, width: 100, height: 12 },
  zIndex: 1,
} as AnyElement;

function template(): PdfTemplate {
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
    datasets: [],
    parameters: [],
    bands: [
      { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 30 }, elements: [el] },
    ],
    resources: { fonts: [], images: [] },
  };
}

const registry = () => new ElementRegistry().register('gauge', gauge);

describe('custom-element registry (§12)', () => {
  it('resolves registered renderer output into the layout tree', () => {
    const doc = layoutDocument(
      template(),
      { data: { score: 100 } },
      { paginate: { elements: registry() } },
    );
    const laid = doc.pages[0]!.elements.find((e) => e.id === 'g')!;
    expect(laid.custom).toHaveLength(3);
    // value 100 of max 200 → half-width fill (100 * 0.5 = 50).
    expect(laid.custom![1]).toMatchObject({ op: 'rect', w: 50 });
    expect(doc.diagnostics).toHaveLength(0);
  });

  it('draws the ops in the SVG preview at the element position', () => {
    const doc = layoutDocument(
      template(),
      { data: { score: 100 } },
      { paginate: { elements: registry() } },
    );
    const svg = paintToSvg(doc)[0]!;
    // page margin 20 + x 10 = 30; fill rect 50 wide.
    expect(svg).toContain('x="30"');
    expect(svg).toContain('width="50"');
  });

  it('renders through the PDF painter without diagnostics', async () => {
    const result = await renderToPdf(
      template(),
      { data: { score: 100 } },
      { paginate: { elements: registry() } },
    );
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe('%PDF-');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('warns (non-fatal) when the renderer is not registered', () => {
    const doc = layoutDocument(template(), { data: { score: 100 } });
    expect(doc.diagnostics.some((d) => /custom element 'gauge'/.test(d.message))).toBe(true);
    expect(doc.pages[0]!.elements.find((e) => e.id === 'g')!.custom).toBeUndefined();
  });

  it('clone() copies registered renderers', () => {
    const copy = registry().clone();
    expect(copy.has('gauge')).toBe(true);
  });
});
