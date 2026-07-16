import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const RED = { space: 'rgb', r: 220, g: 38, b: 38 } as const;
const YELLOW = { space: 'rgb', r: 254, g: 240, b: 138 } as const;

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
    datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
    parameters: [],
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 60 }, elements }],
    resources: { fonts: [], images: [] },
  };
}

const amountField = (id: string, source: string): AnyElement =>
  ({
    id,
    type: 'dataField',
    bounds: { x: 0, y: 0, width: 100, height: 16 },
    zIndex: 1,
    value: { source },
    typography: { color: { space: 'rgb', r: 0, g: 0, b: 0 } },
    conditionalStyles: [
      { when: { source }, typography: { color: { space: 'rgb', r: 0, g: 0, b: 0 } } },
      {
        when: { source: `${source} < 0` },
        typography: { color: RED },
        box: { fill: { color: YELLOW } },
      },
    ],
  }) as AnyElement;

const colorOf = (el: { typography?: { color?: unknown } }): unknown => el.typography?.color;

describe('conditional formatting (§11A-D)', () => {
  it('applies the overlay when the condition is truthy (negative → red + highlight)', () => {
    const el = layoutDocument(template([amountField('a', 'amount')]), {
      data: { amount: -5 },
    }).pages[0]!.elements.find((e) => e.id === 'a')!;
    expect(colorOf(el)).toEqual(RED);
    expect(el.box?.fill?.color).toEqual(YELLOW);
  });

  it('leaves the base style when the condition is falsy (positive → black)', () => {
    const el = layoutDocument(template([amountField('a', 'amount')]), {
      data: { amount: 12 },
    }).pages[0]!.elements.find((e) => e.id === 'a')!;
    expect(colorOf(el)).toEqual({ space: 'rgb', r: 0, g: 0, b: 0 });
    expect(el.box?.fill).toBeUndefined();
  });

  it('applies overlays in order (later wins)', () => {
    const el = {
      id: 'x',
      type: 'staticText',
      bounds: { x: 0, y: 0, width: 100, height: 16 },
      zIndex: 1,
      text: 'hi',
      conditionalStyles: [
        { when: { source: 'true' }, typography: { color: { space: 'rgb', r: 1, g: 1, b: 1 } } },
        { when: { source: 'true' }, typography: { color: RED } },
      ],
    } as AnyElement;
    const laid = layoutDocument(template([el]), { data: {} }).pages[0]!.elements.find(
      (e) => e.id === 'x',
    )!;
    expect(colorOf(laid)).toEqual(RED);
  });
});
