import type { AnyElement } from '../model/elements';
import { validateTemplate } from '../validation/validate';
import { cloneFormat } from './clone';
import type { ExtractedPage, ExtractedText } from './types';

function txt(text: string, x: number, y: number, over: Partial<ExtractedText> = {}): ExtractedText {
  return { text, x, y, dir: 'ltr', fontSize: 10, width: text.length * 5, ...over };
}

/** A synthetic invoice: one header field + a 3-column table with a header row. */
function invoicePage(): ExtractedPage {
  const texts: ExtractedText[] = [
    txt('Invoice No:', 40, 800),
    txt('INV-1024', 140, 800),
    txt('Item', 40, 700),
    txt('Qty', 300, 700),
    txt('Price', 420, 700),
    txt('widget', 40, 680),
    txt('2', 300, 680),
    txt('1,000', 420, 680),
    txt('gadget', 40, 660),
    txt('5', 300, 660),
    txt('2,000', 420, 660),
  ];
  return { width: 595, height: 842, texts, segments: [], rects: [], warnings: [] };
}

const elements = (r: { template: { bands: Array<{ elements: AnyElement[] }> } }): AnyElement[] =>
  r.template.bands.flatMap((b) => b.elements);

describe('cloneFormat (F2.4)', () => {
  it('binds header values to dataFields and keeps labels static', async () => {
    const res = await cloneFormat([invoicePage()]);
    const els = elements(res);
    const field = els.find((e) => e.type === 'dataField') as
      | Extract<AnyElement, { type: 'dataField' }>
      | undefined;
    expect(field?.value.source).toBe('invoice_no');
    const label = els.find((e) => e.type === 'staticText' && e.text === 'Invoice No:');
    expect(label).toBeTruthy();
  });

  it('collapses the item rows into one bound table + a declared dataset', async () => {
    const res = await cloneFormat([invoicePage()]);
    const table = elements(res).find((e) => e.type === 'table') as
      | Extract<AnyElement, { type: 'table' }>
      | undefined;
    expect(table).toBeTruthy();
    expect(table!.dataset).toBe('items');
    expect(table!.columns).toHaveLength(3);
    expect(table!.columns[0]!.detail?.content?.source).toBe('item');
    expect(table!.columns[0]!.header?.text).toBe('Item');
    expect(res.template.datasets.some((d) => d.name === 'items')).toBe(true);
  });

  it('returns faithful inferred sample data', async () => {
    const { inferredData } = await cloneFormat([invoicePage()]);
    expect(inferredData['invoice_no']).toBe('INV-1024');
    const items = inferredData['items'] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ item: 'widget', qty: '2', price: '1,000' });
  });

  it('produces a schema-valid template', async () => {
    const res = await cloneFormat([invoicePage()]);
    const check = validateTemplate(res.template);
    if (!check.success) {
      throw new Error('invalid: ' + JSON.stringify(check.issues?.slice(0, 3)));
    }
    expect(check.success).toBe(true);
  });

  it('works with no classifier (keyless path) and names the doc', async () => {
    const res = await cloneFormat([invoicePage()], { name: 'My Clone' });
    expect(res.template.metadata.name).toBe('My Clone');
    expect(elements(res).some((e) => e.type === 'table')).toBe(true);
  });
});
