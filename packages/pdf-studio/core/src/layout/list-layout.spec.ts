import type { ListElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument } from '../render';
import { renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function withList(list: ListElement): PdfTemplate {
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
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'auto', min: 10 }, elements: [list] }],
    resources: { fonts: [], images: [] },
  };
}

const list = (overrides: Partial<ListElement> = {}): ListElement => ({
  id: 'lst',
  type: 'list',
  bounds: { x: 0, y: 0, width: 300, height: 20 },
  zIndex: 1,
  dataset: 'items',
  itemHeight: 30,
  itemTemplate: [
    {
      id: 'name',
      type: 'dataField',
      bounds: { x: 0, y: 0, width: 200, height: 16 },
      zIndex: 1,
      value: { source: 'name' },
    },
    {
      id: 'price',
      type: 'dataField',
      bounds: { x: 200, y: 0, width: 100, height: 16 },
      zIndex: 1,
      value: { source: 'price' },
    },
  ],
  ...overrides,
});

const DATA = {
  items: [
    { name: 'A', price: 10 },
    { name: 'B', price: 20 },
    { name: 'C', price: 30 },
  ],
};

describe('list / repeater layout (§5, Phase 2)', () => {
  const items = (t: PdfTemplate) =>
    layoutDocument(t, { data: DATA }).pages[0]!.elements.filter((e) => e.id.startsWith('lst:'));

  it('repeats the item template once per row with row-scoped data', () => {
    const els = items(withList(list()));
    expect(els.filter((e) => e.id.endsWith(':name')).map((e) => e.text)).toEqual(['A', 'B', 'C']);
    expect(els.filter((e) => e.id.endsWith(':price')).map((e) => e.text)).toEqual([
      '10',
      '20',
      '30',
    ]);
  });

  it('stacks items vertically by itemHeight + gap', () => {
    const names = items(withList(list({ gap: 5 }))).filter((e) => e.id.endsWith(':name'));
    // y advances by itemHeight(30) + gap(5) = 35 per row (absolute = page offset + slot).
    expect(names[1]!.bounds.y - names[0]!.bounds.y).toBe(35);
    expect(names[2]!.bounds.y - names[1]!.bounds.y).toBe(35);
  });

  it('flows horizontally when orientation is horizontal', () => {
    const names = items(withList(list({ orientation: 'horizontal', gap: 10 }))).filter((e) =>
      e.id.endsWith(':name'),
    );
    // x advances by item width (max right edge = 300) + gap(10) per row.
    expect(names[1]!.bounds.x - names[0]!.bounds.x).toBe(310);
  });

  it('exposes $index to item templates', () => {
    const t = withList(
      list({
        itemTemplate: [
          {
            id: 'i',
            type: 'dataField',
            bounds: { x: 0, y: 0, width: 40, height: 16 },
            zIndex: 1,
            value: { source: '$index' },
          },
        ],
      }),
    );
    expect(items(t).map((e) => e.text)).toEqual(['0', '1', '2']);
  });

  it('renders list items in the SVG preview', () => {
    const svg = renderToSvg(withList(list()), { data: DATA }).pages[0]!;
    expect(svg).toContain('A');
    expect(svg).toContain('30');
  });
});
