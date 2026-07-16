import { paintToSvg } from '../paint/svg-painter';
import type { AnyElement } from '../model/elements';
import type { IconSet } from '../model/element-base';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf } from '../render';
import { pickIcon } from './conditional-visuals';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const red = { space: 'rgb', r: 200, g: 0, b: 0 } as const;
const amber = { space: 'rgb', r: 255, g: 191, b: 0 } as const;
const green = { space: 'rgb', r: 0, g: 160, b: 0 } as const;

// Traffic-light set: <50 red triangleDown, <80 amber square, else green circle.
const traffic: IconSet = {
  value: { source: 'score' },
  thresholds: [
    { at: 0, icon: 'triangleDown', color: red },
    { at: 50, icon: 'square', color: amber },
    { at: 80, icon: 'circle', color: green },
  ],
};

describe('pickIcon (§11A-D)', () => {
  it('selects the highest threshold at or below the value', () => {
    expect(pickIcon(traffic, 20)).toEqual({ name: 'triangleDown', color: red });
    expect(pickIcon(traffic, 60)).toEqual({ name: 'square', color: amber });
    expect(pickIcon(traffic, 95)).toEqual({ name: 'circle', color: green });
  });

  it('uses the lowest threshold for values below all of them', () => {
    expect(
      pickIcon({ value: { source: 'x' }, thresholds: [{ at: 10, icon: 'square' }] }, 5).name,
    ).toBe('square');
  });
});

const field = (id: string, extra: Partial<AnyElement>): AnyElement =>
  ({
    id,
    type: 'dataField',
    bounds: { x: 0, y: 0, width: 100, height: 20 },
    zIndex: 1,
    value: { source: 'score' },
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

describe('icon sets in layout/paint (§11A-D)', () => {
  it('resolves an icon and emits a vector glyph in SVG', () => {
    const doc = layoutDocument(template([field('i', { iconSet: traffic })]), {
      data: { score: 95 },
    });
    const laid = doc.pages[0]!.elements.find((e) => e.id === 'i')!;
    expect(laid.icon).toEqual({ name: 'circle', color: green });
    const svg = paintToSvg(doc)[0]!;
    expect(svg).toContain('<circle');
    expect(svg).toContain('rgb(0, 160, 0)');
  });

  it('emits a polygon for triangle icons', () => {
    const doc = layoutDocument(template([field('i', { iconSet: traffic })]), {
      data: { score: 10 },
    });
    const svg = paintToSvg(doc)[0]!;
    expect(svg).toContain('<polygon');
  });

  it('renders to PDF without error', async () => {
    const result = await renderToPdf(template([field('i', { iconSet: traffic })]), {
      data: { score: 60 },
    });
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });
});
