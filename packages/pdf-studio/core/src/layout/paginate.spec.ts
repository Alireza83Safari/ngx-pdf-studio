import { createRenderContext } from '../binding/render-context';
import type { Band } from '../model/band';
import type { DatasetDef } from '../model/dataset';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { paginate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function template(bands: Band[], datasets: DatasetDef[] = []): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'test' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      direction: 'ltr',
      locale: EN,
      unit: 'pt',
    },
    styles: [],
    datasets,
    parameters: [],
    bands,
    resources: { fonts: [], images: [] },
  };
}

const itemsDataset: DatasetDef = { name: 'items', source: { kind: 'path', path: 'items' } };

// A4 portrait with 20pt margins → content.y=20, availBottom≈801.89.
const AVAIL_BOTTOM = 841.89 - 40;

describe('pagination engine (§6)', () => {
  it('lays out a single page with repeating header/footer and detail rows', () => {
    const tpl = template(
      [
        {
          id: 'h',
          type: 'pageHeader',
          height: { mode: 'fixed', value: 30 },
          elements: [
            {
              id: 'ht',
              type: 'staticText',
              bounds: { x: 0, y: 0, width: 100, height: 20 },
              zIndex: 1,
              text: 'H',
            },
          ],
        },
        {
          id: 'd',
          type: 'detail',
          height: { mode: 'fixed', value: 20 },
          dataset: 'items',
          elements: [
            {
              id: 'name',
              type: 'dataField',
              bounds: { x: 0, y: 0, width: 100, height: 20 },
              zIndex: 1,
              value: { source: 'name' },
            },
          ],
        },
        {
          id: 'f',
          type: 'pageFooter',
          height: { mode: 'fixed', value: 20 },
          elements: [
            {
              id: 'pg',
              type: 'pageField',
              bounds: { x: 0, y: 0, width: 50, height: 16 },
              zIndex: 1,
              field: 'page',
            },
          ],
        },
      ],
      [itemsDataset],
    );
    const ctx = createRenderContext({
      data: { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
    });
    const doc = paginate(tpl, ctx);

    expect(doc.pageCount).toBe(1);
    const texts = doc.pages[0]!.elements.map((e) => e.text);
    expect(texts).toContain('H');
    expect(texts).toEqual(expect.arrayContaining(['a', 'b', 'c', '1']));

    // Detail rows start below the reserved header (availTop = 20 + 30 = 50).
    const details = doc.pages[0]!.elements.filter((e) => e.id === 'name');
    expect(details.map((e) => e.bounds.y)).toEqual([50, 70, 90]);

    // Footer sits at the reserved bottom.
    const footer = doc.pages[0]!.elements.find((e) => e.id === 'pg')!;
    expect(footer.bounds.y).toBeCloseTo(AVAIL_BOTTOM, 1);
  });

  it('breaks detail rows across pages and repeats header/footer on each', () => {
    const tpl = template(
      [
        {
          id: 'h',
          type: 'pageHeader',
          height: { mode: 'fixed', value: 30 },
          elements: [
            {
              id: 'ht',
              type: 'staticText',
              bounds: { x: 0, y: 0, width: 100, height: 20 },
              zIndex: 1,
              text: 'H',
            },
          ],
        },
        {
          id: 'd',
          type: 'detail',
          height: { mode: 'fixed', value: 300 },
          dataset: 'items',
          elements: [
            {
              id: 'row',
              type: 'dataField',
              bounds: { x: 0, y: 0, width: 100, height: 20 },
              zIndex: 1,
              value: { source: 'name' },
            },
          ],
        },
        {
          id: 'f',
          type: 'pageFooter',
          height: { mode: 'fixed', value: 20 },
          elements: [
            {
              id: 'pc',
              type: 'pageField',
              bounds: { x: 0, y: 0, width: 80, height: 16 },
              zIndex: 1,
              field: 'pageCount',
            },
          ],
        },
      ],
      [itemsDataset],
    );
    const data = {
      items: [{ name: '0' }, { name: '1' }, { name: '2' }, { name: '3' }, { name: '4' }],
    };
    const doc = paginate(tpl, createRenderContext({ data }));

    // usable ≈ 751.89; two 300pt rows per page → 3 pages for 5 rows.
    expect(doc.pageCount).toBe(3);
    expect(doc.pages.map((p) => p.elements.filter((e) => e.id === 'row').length)).toEqual([
      2, 2, 1,
    ]);

    // Header repeats on every page; footer shows $pageCount = 3 everywhere.
    for (const page of doc.pages) {
      expect(page.elements.some((e) => e.id === 'ht' && e.text === 'H')).toBe(true);
      expect(page.elements.find((e) => e.id === 'pc')!.text).toBe('3');
    }
  });

  it('exposes $index/$first/$last to detail rows', () => {
    const tpl = template(
      [
        {
          id: 'd',
          type: 'detail',
          height: { mode: 'fixed', value: 20 },
          dataset: 'items',
          elements: [
            {
              id: 'idx',
              type: 'dataField',
              bounds: { x: 0, y: 0, width: 50, height: 16 },
              zIndex: 1,
              value: { source: '$index' },
            },
            {
              id: 'firstOnly',
              type: 'staticText',
              bounds: { x: 60, y: 0, width: 50, height: 16 },
              zIndex: 1,
              text: 'FIRST',
              visibleWhen: { source: '$first' },
            },
          ],
        },
      ],
      [itemsDataset],
    );
    const doc = paginate(tpl, createRenderContext({ data: { items: [{}, {}, {}] } }));
    expect(doc.pages[0]!.elements.filter((e) => e.id === 'idx').map((e) => e.text)).toEqual([
      '0',
      '1',
      '2',
    ]);
    expect(doc.pages[0]!.elements.filter((e) => e.id === 'firstOnly').length).toBe(1);
  });

  it('auto-grows a band to fit wrapped text', () => {
    const longText = 'word '.repeat(40).trim();
    const tpl = template([
      {
        id: 'd',
        type: 'detail',
        height: { mode: 'auto', min: 10 },
        elements: [
          {
            id: 't',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 80, height: 12 },
            zIndex: 1,
            text: longText,
          },
        ],
      },
    ]);
    const doc = paginate(tpl, createRenderContext({ data: {} }));
    const el = doc.pages[0]!.elements.find((e) => e.id === 't')!;
    // Wrapped over many lines → measured height far exceeds the authored 12pt.
    expect(el.lines!.length).toBeGreaterThan(1);
    expect(el.bounds.height).toBeGreaterThan(12);
  });

  it('resolves direction: explicit rtl, and content-based bidi for auto', () => {
    const tpl = template([
      {
        id: 'd',
        type: 'detail',
        height: { mode: 'fixed', value: 20 },
        elements: [
          {
            id: 'rtl',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 50, height: 16 },
            zIndex: 1,
            text: 'x',
            direction: 'rtl',
          },
          // auto + Persian content → bidi detects rtl (content wins, §11)
          {
            id: 'autoFa',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 50, height: 16 },
            zIndex: 1,
            text: 'سلام',
            direction: 'auto',
          },
          // auto + Latin content → bidi detects ltr
          {
            id: 'autoEn',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 50, height: 16 },
            zIndex: 1,
            text: 'hello',
            direction: 'auto',
          },
        ],
      },
    ]);
    const els = paginate(tpl, createRenderContext({ data: {} })).pages[0]!.elements;
    expect(els.find((e) => e.id === 'rtl')!.direction).toBe('rtl');
    expect(els.find((e) => e.id === 'autoFa')!.direction).toBe('rtl');
    expect(els.find((e) => e.id === 'autoEn')!.direction).toBe('ltr');
  });

  it('produces a deterministic layout tree (snapshot)', () => {
    const tpl = template(
      [
        {
          id: 'd',
          type: 'detail',
          height: { mode: 'fixed', value: 20 },
          dataset: 'items',
          elements: [
            {
              id: 'n',
              type: 'dataField',
              bounds: { x: 0, y: 0, width: 100, height: 16 },
              zIndex: 1,
              value: { source: 'name' },
            },
          ],
        },
      ],
      [itemsDataset],
    );
    const doc = paginate(
      tpl,
      createRenderContext({ data: { items: [{ name: 'a' }, { name: 'b' }] } }),
    );
    const tree = doc.pages.map((p) => ({
      number: p.number,
      elements: p.elements.map((e) => ({ id: e.id, type: e.type, bounds: e.bounds, text: e.text })),
    }));
    expect(tree).toMatchSnapshot();
  });
});
