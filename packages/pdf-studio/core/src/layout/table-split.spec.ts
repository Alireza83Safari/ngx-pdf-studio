import { createRenderContext } from '../binding/render-context';
import type { AnyElement } from '../model/elements';
import type { DatasetDef } from '../model/dataset';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { paginate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const items: DatasetDef = { name: 'items', source: { kind: 'path', path: 'items' } };

// A single auto-height band holding one long table.
const table: AnyElement = {
  id: 'tbl',
  type: 'table',
  bounds: { x: 0, y: 0, width: 400, height: 100 },
  zIndex: 1,
  dataset: 'items',
  columns: [
    {
      id: 'c0',
      width: { kind: 'fixed', value: 200 },
      header: { text: 'Name' },
      detail: { content: { source: 'name' } },
    },
    {
      id: 'c1',
      width: { kind: 'fixed', value: 200 },
      header: { text: 'Qty' },
      detail: { content: { source: 'qty' } },
    },
  ],
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
    datasets: [items],
    parameters: [],
    bands: [{ id: 'b', type: 'detail', height: { mode: 'auto' }, elements: [table] }],
    resources: { fonts: [], images: [] },
  };
}

// ~60 rows ≈ well beyond one A4 page of default-height rows.
const data = {
  items: Array.from({ length: 60 }, (_, i) => ({ name: `Item ${i + 1}`, qty: i + 1 })),
};

describe('table split across pages with repeated header (§6)', () => {
  const doc = paginate(template(), createRenderContext({ data }));

  it('flows the long table onto multiple pages', () => {
    expect(doc.pageCount).toBeGreaterThan(1);
    // Every row made it somewhere — none silently dropped.
    const cells = doc.pages.flatMap((p) => p.elements).filter((e) => e.text?.startsWith('Item '));
    expect(cells.length).toBe(60);
  });

  it('repeats the header cells at the top of every page', () => {
    for (const page of doc.pages) {
      const headers = page.elements.filter((e) => e.text === 'Name');
      expect(headers.length).toBe(1);
      // Header sits above every data cell on its page.
      const headerTop = headers[0]!.bounds.y;
      const rowTops = page.elements
        .filter((e) => e.text?.startsWith('Item '))
        .map((e) => e.bounds.y);
      expect(Math.min(...rowTops)).toBeGreaterThan(headerTop);
    }
  });

  it('keeps rows within the page content area', () => {
    for (const page of doc.pages) {
      for (const el of page.elements) {
        expect(el.bounds.y + el.bounds.height).toBeLessThanOrEqual(842 - 20 + 0.01);
      }
    }
  });

  it('keeps row order across the split', () => {
    const names = doc.pages.flatMap((p) =>
      p.elements
        .filter((e) => e.text?.startsWith('Item '))
        .sort((a, b) => a.bounds.y - b.bounds.y)
        .map((e) => e.text),
    );
    expect(names[0]).toBe('Item 1');
    expect(names[names.length - 1]).toBe('Item 60');
  });
});
