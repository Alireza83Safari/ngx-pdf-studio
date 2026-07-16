import { paintToSvg } from '../paint/svg-painter';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument } from '../render';
import { colorScaleColor, dataBarFraction } from './conditional-visuals';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const green = { space: 'rgb', r: 0, g: 200, b: 0 } as const;
const red = { space: 'rgb', r: 200, g: 0, b: 0 } as const;
const blue = { space: 'rgb', r: 0, g: 128, b: 255 } as const;

describe('conditional-visuals helpers (§11A-D)', () => {
  it('dataBarFraction clamps to the unit interval', () => {
    expect(dataBarFraction(50, 100)).toBe(0.5);
    expect(dataBarFraction(50, 100, 50)).toBe(0); // at min
    expect(dataBarFraction(150, 100)).toBe(1); // above max → clamp
    expect(dataBarFraction(-10, 100)).toBe(0); // below min → clamp
    expect(dataBarFraction(5, 0)).toBe(0); // degenerate span
  });

  it('colorScaleColor interpolates linearly in sRGB', () => {
    const stops = [
      { at: 0, color: green },
      { at: 10, color: red },
    ];
    expect(colorScaleColor(stops, 0)).toEqual(green);
    expect(colorScaleColor(stops, 10)).toEqual(red);
    expect(colorScaleColor(stops, 5)).toEqual({ space: 'rgb', r: 100, g: 100, b: 0 }); // midpoint
    expect(colorScaleColor(stops, -3)).toEqual(green); // below first stop
    expect(colorScaleColor(stops, 99)).toEqual(red); // above last stop
  });
});

const field = (id: string, x: number, extra: Partial<AnyElement>): AnyElement =>
  ({
    id,
    type: 'dataField',
    bounds: { x, y: 0, width: 100, height: 20 },
    zIndex: 1,
    value: { source: 'n' },
    ...extra,
  }) as AnyElement;

function template(elements: AnyElement[]): PdfTemplate {
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
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 40 }, elements }],
    resources: { fonts: [], images: [] },
  };
}

describe('data bars & color scales in layout/paint (§11A-D)', () => {
  it('resolves a data bar fraction and emits its bar in SVG', () => {
    const tpl = template([
      field('bar', 0, { dataBar: { value: { source: '50' }, max: 100, color: blue } }),
    ]);
    const doc = layoutDocument(tpl, { data: { n: 50 } });
    const laid = doc.pages[0]!.elements.find((e) => e.id === 'bar')!;
    expect(laid.dataBar).toEqual({ fraction: 0.5, color: blue });
    // bar width = 100 * 0.5 = 50, drawn as a rect with the bar color.
    const svg = paintToSvg(doc)[0]!;
    expect(svg).toContain('width="50"');
    expect(svg).toContain('rgb(0, 128, 255)');
  });

  it('fills with an interpolated color-scale color via the box fill', () => {
    const tpl = template([
      field('cs', 0, {
        colorScale: {
          value: { source: '5' },
          stops: [
            { at: 0, color: green },
            { at: 10, color: red },
          ],
        },
      }),
    ]);
    const doc = layoutDocument(tpl, { data: { n: 5 } });
    const laid = doc.pages[0]!.elements.find((e) => e.id === 'cs')!;
    expect(laid.box?.fill?.color).toEqual({ space: 'rgb', r: 100, g: 100, b: 0 });
  });

  it('grows the data bar from the right edge in RTL', () => {
    const tpl = template([
      field('rtl', 0, {
        direction: 'rtl',
        dataBar: { value: { source: '25' }, max: 100, color: blue },
      }),
    ]);
    const doc = layoutDocument(tpl, { data: { n: 25 } });
    const svg = paintToSvg(doc)[0]!;
    // fraction 0.25 → width 25; x = pageMargin(20) + 0 + (100 - 25) = 95.
    expect(svg).toContain('x="95"');
    expect(svg).toContain('width="25"');
  });
});
