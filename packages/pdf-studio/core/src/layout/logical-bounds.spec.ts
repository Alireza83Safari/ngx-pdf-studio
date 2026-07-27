/**
 * `coordinates: 'logical'` (§7) — authoring an RTL page in reading order and
 * letting the engine mirror it, instead of every template hand-computing
 * `contentWidth - x`.
 */
import { withLogicalBounds } from './logical-bounds';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PageSetup } from '../model/page';
import type { PdfTemplate } from '../model/template';
import { renderToSvg } from '../render';

const FA: LocaleSetup = { language: 'fa', digits: 'persian', calendar: 'jalali' };
const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

// A4 portrait with 20pt margins → 555.28pt of content width.
const CONTENT = 595.28 - 40;

const page = (over: Partial<PageSetup> = {}): PageSetup => ({
  size: 'A4',
  orientation: 'portrait',
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  direction: 'rtl',
  locale: FA,
  unit: 'pt',
  ...over,
});

const text = (id: string, x: number, width: number): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x, y: 0, width, height: 12 },
  zIndex: 1,
  text: id,
});

const template = (over: Partial<PdfTemplate> = {}): PdfTemplate => ({
  schemaVersion: '1.0.0',
  metadata: { name: 't' },
  page: page(),
  styles: [],
  datasets: [],
  parameters: [],
  bands: [
    {
      id: 'b',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 100 },
      elements: [text('title', 0, 200)],
    },
  ],
  resources: { fonts: [], images: [] },
  ...over,
});

const xOf = (t: PdfTemplate, i = 0): number => t.bands[0]!.elements[i]!.bounds.x;

describe('withLogicalBounds (§7)', () => {
  it('is a no-op — same reference — when no page opts in', () => {
    const t = template();
    expect(withLogicalBounds(t)).toBe(t);
  });

  it('is a no-op on an LTR page, where logical already equals physical', () => {
    const t = template({ page: page({ direction: 'ltr', coordinates: 'logical', locale: EN }) });
    expect(withLogicalBounds(t)).toBe(t);
  });

  it('mirrors x on an RTL logical page so x=0 becomes the right edge', () => {
    const t = template({ page: page({ coordinates: 'logical' }) });
    // authored at the start edge → ends flush with the right edge
    expect(xOf(withLogicalBounds(t))).toBeCloseTo(CONTENT - 200, 5);
  });

  it('leaves the original template untouched', () => {
    const t = template({ page: page({ coordinates: 'logical' }) });
    withLogicalBounds(t);
    expect(xOf(t)).toBe(0);
  });

  it('is its own inverse, so a round-trip returns the authored value', () => {
    const t = template({ page: page({ coordinates: 'logical' }) });
    expect(xOf(withLogicalBounds(withLogicalBounds(t)))).toBeCloseTo(0, 5);
  });

  it('keeps reading order: a label authored before its value ends up to its right', () => {
    const t = template({
      page: page({ coordinates: 'logical' }),
      bands: [
        {
          id: 'b',
          type: 'reportHeader',
          height: { mode: 'fixed', value: 100 },
          elements: [text('label', 0, 60), text('value', 60, 200)],
        },
      ],
    });
    const out = withLogicalBounds(t);
    expect(xOf(out, 0)).toBeGreaterThan(xOf(out, 1));
  });

  it('mirrors container children against the container, not the page', () => {
    const t = template({
      page: page({ coordinates: 'logical' }),
      bands: [
        {
          id: 'b',
          type: 'reportHeader',
          height: { mode: 'fixed', value: 100 },
          elements: [
            {
              id: 'group',
              type: 'container',
              bounds: { x: 0, y: 0, width: 100, height: 50 },
              zIndex: 1,
              children: [text('inner', 0, 30)],
            } as AnyElement,
          ],
        },
      ],
    });
    const group = withLogicalBounds(t).bands[0]!.elements[0]!;
    expect(group.bounds.x).toBeCloseTo(CONTENT - 100, 5);
    if (group.type === 'container') expect(group.children[0]!.bounds.x).toBe(70); // 100 - 0 - 30
  });

  it('mirrors list item templates against the list box', () => {
    const t = template({
      page: page({ coordinates: 'logical' }),
      bands: [
        {
          id: 'b',
          type: 'reportHeader',
          height: { mode: 'fixed', value: 100 },
          elements: [
            {
              id: 'rows',
              type: 'list',
              dataset: 'ds',
              itemHeight: 20,
              bounds: { x: 0, y: 0, width: 200, height: 60 },
              zIndex: 1,
              itemTemplate: [text('cell', 10, 40)],
            } as AnyElement,
          ],
        },
      ],
    });
    const list = withLogicalBounds(t).bands[0]!.elements[0]!;
    if (list.type === 'list') expect(list.itemTemplate[0]!.bounds.x).toBe(150); // 200 - 10 - 40
  });

  it('mirrors against column width on a multi-column page', () => {
    const t = template({
      page: page({ coordinates: 'logical', columns: { count: 2, gap: 20 } }),
    });
    // (555.28 - 20) / 2 = 267.64 per column
    expect(xOf(withLogicalBounds(t))).toBeCloseTo((CONTENT - 20) / 2 - 200, 5);
  });

  it('mirrors only the sections that opt in', () => {
    const t = template({
      page: page(),
      sections: [
        {
          id: 's1',
          page: page({ coordinates: 'logical' }),
          bands: [
            {
              id: 'b1',
              type: 'reportHeader',
              height: { mode: 'fixed', value: 50 },
              elements: [text('a', 0, 100)],
            },
          ],
        },
        {
          id: 's2',
          page: page(),
          bands: [
            {
              id: 'b2',
              type: 'reportHeader',
              height: { mode: 'fixed', value: 50 },
              elements: [text('b', 0, 100)],
            },
          ],
        },
      ],
    });
    const out = withLogicalBounds(t);
    expect(out.sections![0]!.bands[0]!.elements[0]!.bounds.x).toBeCloseTo(CONTENT - 100, 5);
    expect(out.sections![1]!.bands[0]!.elements[0]!.bounds.x).toBe(0);
  });
});

describe('logical coordinates through the real render pipeline (§7)', () => {
  const withTitle = (coordinates?: 'logical' | 'physical'): PdfTemplate =>
    template({ page: page(coordinates ? { coordinates } : {}) });

  const titleX = (t: PdfTemplate): number => {
    const svg = renderToSvg(t, {}).pages[0]!;
    return Number(/<tspan x="([\d.]+)"/.exec(svg)![1]);
  };

  it('puts a logical title on the right and a physical one on the left', () => {
    // margin 20 + content 555.28; `align: start` on RTL anchors the right edge
    expect(titleX(withTitle('logical'))).toBeCloseTo(20 + CONTENT, 1);
    expect(titleX(withTitle())).toBeCloseTo(20 + 200, 1);
  });
});
