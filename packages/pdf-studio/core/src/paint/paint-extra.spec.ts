import { layoutDocument } from '../render';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { colorToCss } from './color';
import { paintToSvg } from './svg-painter';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function svgOf(elements: AnyElement[]): string {
  const tpl: PdfTemplate = {
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
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 200 }, elements }],
    resources: { fonts: [], images: [] },
  };
  return paintToSvg(layoutDocument(tpl))[0]!;
}

const base = (
  id: string,
  type: AnyElement['type'],
): {
  id: string;
  type: AnyElement['type'];
  bounds: { x: number; y: number; width: number; height: number };
  zIndex: number;
} => ({
  id,
  type,
  bounds: { x: 0, y: 0, width: 40, height: 30 },
  zIndex: 1,
});

describe('colorToCss', () => {
  it('emits rgb, rgba (alpha), and approximates cmyk/spot', () => {
    expect(colorToCss({ space: 'rgb', r: 1, g: 2, b: 3 })).toBe('rgb(1, 2, 3)');
    expect(colorToCss({ space: 'rgb', r: 0, g: 0, b: 0, a: 0.5 })).toBe('rgba(0, 0, 0, 0.5)');
    expect(colorToCss({ space: 'cmyk', c: 0, m: 0, y: 0, k: 1 })).toBe('rgb(0, 0, 0)');
    expect(
      colorToCss({
        space: 'spot',
        name: 'X',
        approximation: { space: 'rgb', r: 10, g: 20, b: 30 },
      }),
    ).toBe('rgb(10, 20, 30)');
  });
});

describe('svg-painter shapes and text variants', () => {
  it('renders ellipse and line elements', () => {
    const svg = svgOf([
      {
        ...base('e', 'ellipse'),
        box: { fill: { color: { space: 'rgb', r: 1, g: 1, b: 1 } } },
      } as AnyElement,
      {
        ...base('l', 'line'),
        stroke: { width: 2, color: { space: 'rgb', r: 0, g: 0, b: 0 } },
      } as AnyElement,
    ]);
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('<line');
  });

  it('maps alignment to text-anchor and honors rtl/italic/underline', () => {
    const svg = svgOf([
      { ...base('c', 'staticText'), text: 'C', typography: { align: 'center' } } as AnyElement,
      { ...base('r', 'staticText'), text: 'R', typography: { align: 'end' } } as AnyElement,
      {
        ...base('fa', 'staticText'),
        text: 'F',
        direction: 'rtl',
        typography: { fontStyle: 'italic', decoration: 'underline' },
      } as AnyElement,
    ]);
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('text-anchor="end"'); // align:end with ltr → right → end
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('text-decoration="underline"');
  });

  it('renders opacity and rounded-rect radius on a box', () => {
    const svg = svgOf([
      {
        ...base('bx', 'rectangle'),
        box: {
          fill: { color: { space: 'rgb', r: 200, g: 200, b: 200 } },
          opacity: 0.5,
          border: { all: { width: 1, color: { space: 'rgb', r: 0, g: 0, b: 0 } }, radius: 4 },
        },
      } as AnyElement,
    ]);
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('rx="4"');
  });
});
