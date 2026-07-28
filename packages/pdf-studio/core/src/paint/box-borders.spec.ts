/**
 * Per-side borders and dashed strokes (§5). The model has carried `BorderSet`
 * with four sides and `BorderStyle: solid | dashed | dotted` from the start, but
 * both painters read `border.all ?? border.top` and drew a single solid
 * rectangle — so a border declared on one edge silently vanished and every dash
 * rendered solid, in the preview *and* in the PDF.
 */
import { dashPattern, resolveBorderEdges } from './paint-style';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { BorderSet } from '../model/style';
import type { PdfTemplate } from '../model/template';
import { renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const BLACK = { space: 'rgb' as const, r: 0, g: 0, b: 0 };

const boxed = (border: BorderSet): PdfTemplate => ({
  schemaVersion: '1.0.0',
  metadata: { name: 'borders' },
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
    {
      id: 'b',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 100 },
      elements: [
        {
          id: 'box',
          type: 'rectangle',
          bounds: { x: 0, y: 0, width: 100, height: 50 },
          zIndex: 1,
          box: { border },
        } as AnyElement,
      ],
    },
  ],
  resources: { fonts: [], images: [] },
});

describe('resolveBorderEdges', () => {
  it('collapses an `all`-only set to one uniform stroke', () => {
    const edges = resolveBorderEdges({ all: { width: 1, color: BLACK } });
    expect(edges.uniform).toBeDefined();
    expect(edges.sides).toHaveLength(0);
  });

  it('returns just the declared side when only one is given', () => {
    const edges = resolveBorderEdges({ bottom: { width: 2, color: BLACK } });
    expect(edges.uniform).toBeUndefined();
    expect(edges.sides.map((s) => s.side)).toEqual(['bottom']);
  });

  it('falls each side back to `all`, per the model', () => {
    const edges = resolveBorderEdges({
      all: { width: 1, color: BLACK },
      bottom: { width: 3, color: BLACK },
    });
    expect(edges.sides.map((s) => s.side)).toEqual(['top', 'right', 'bottom', 'left']);
    expect(edges.sides.find((s) => s.side === 'bottom')!.stroke.width).toBe(3);
    expect(edges.sides.find((s) => s.side === 'top')!.stroke.width).toBe(1);
  });

  it('is empty for no border, or for a set carrying only a radius', () => {
    expect(resolveBorderEdges(undefined).sides).toHaveLength(0);
    expect(resolveBorderEdges({ radius: 4 }).uniform).toBeUndefined();
    expect(resolveBorderEdges({ radius: 4 }).sides).toHaveLength(0);
  });
});

describe('dashPattern', () => {
  it('is undefined for solid and for an unstated style', () => {
    expect(dashPattern({ width: 1, color: BLACK })).toBeUndefined();
    expect(dashPattern({ width: 1, color: BLACK, style: 'solid' })).toBeUndefined();
  });

  it('scales the pattern off the stroke width', () => {
    expect(dashPattern({ width: 2, color: BLACK, style: 'dashed' })).toEqual([6, 4]);
    expect(dashPattern({ width: 2, color: BLACK, style: 'dotted' })).toEqual([2, 4]);
  });

  it('keeps a hairline visibly dashed rather than collapsing to nothing', () => {
    const dash = dashPattern({ width: 0, color: BLACK, style: 'dashed' })!;
    expect(Math.min(...dash)).toBeGreaterThan(0);
  });
});

describe('painting per-side borders (§5)', () => {
  it('draws a bottom-only border as its own line, not a full rectangle', () => {
    const svg = renderToSvg(boxed({ bottom: { width: 2, color: BLACK } }), {}).pages[0]!;
    // the box rect itself carries no stroke…
    expect(svg).not.toMatch(/<rect[^>]*stroke=/);
    // …and exactly one line spans the bottom edge (y = 20 + 50)
    const lines = svg.match(/<line [^>]*\/>/g) ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('y1="70"');
    expect(lines[0]).toContain('y2="70"');
  });

  it('still strokes the rectangle itself when only `all` is given', () => {
    const svg = renderToSvg(boxed({ all: { width: 1, color: BLACK } }), {}).pages[0]!;
    expect(svg).toMatch(/<rect[^>]*stroke=/);
    expect(svg.match(/<line /g) ?? []).toHaveLength(0);
  });

  it('draws all four edges when one side overrides `all`', () => {
    const svg = renderToSvg(
      boxed({ all: { width: 1, color: BLACK }, left: { width: 4, color: BLACK } }),
      {},
    ).pages[0]!;
    expect(svg.match(/<line /g) ?? []).toHaveLength(4);
    expect(svg).toContain('stroke-width="4"');
  });

  it('emits a dash array for dashed and dotted strokes', () => {
    const dashed = renderToSvg(boxed({ all: { width: 2, color: BLACK, style: 'dashed' } }), {})
      .pages[0]!;
    expect(dashed).toContain('stroke-dasharray="6 4"');
    const dotted = renderToSvg(boxed({ bottom: { width: 2, color: BLACK, style: 'dotted' } }), {})
      .pages[0]!;
    expect(dotted).toContain('stroke-dasharray="2 4"');
  });

  it('leaves a solid stroke without a dash array', () => {
    const svg = renderToSvg(boxed({ all: { width: 1, color: BLACK } }), {}).pages[0]!;
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('dashes a line element too', () => {
    const template = boxed({});
    template.bands[0]!.elements = [
      {
        id: 'rule',
        type: 'line',
        bounds: { x: 0, y: 10, width: 200, height: 0 },
        zIndex: 1,
        stroke: { width: 1, color: BLACK, style: 'dashed' },
      } as AnyElement,
    ];
    expect(renderToSvg(template, {}).pages[0]!).toContain('stroke-dasharray="3 2"');
  });

  it('renders the same shapes in the PDF without diagnostics', async () => {
    const pdf = await renderToPdf(
      boxed({
        all: { width: 1, color: BLACK },
        bottom: { width: 3, color: BLACK, style: 'dashed' },
      }),
      {},
    );
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.diagnostics).toHaveLength(0);
  });
});
