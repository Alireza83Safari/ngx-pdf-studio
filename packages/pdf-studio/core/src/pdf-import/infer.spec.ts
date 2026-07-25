import { classifyPage } from './classify';
import { inferData } from './infer';
import type { ExtractedPage, ExtractedText } from './types';

function txt(text: string, x: number, y: number, over: Partial<ExtractedText> = {}): ExtractedText {
  return { text, x, y, dir: 'ltr', fontSize: 10, width: text.length * 5, ...over };
}
function page(texts: ExtractedText[]): ExtractedPage {
  return { width: 595, height: 842, texts, segments: [], rects: [], warnings: [] };
}
function infer(p: ExtractedPage) {
  return inferData([p], [classifyPage(p)]);
}

describe('inferData — scalar fields', () => {
  it('uses the run text as the faithful sample value and records kinds', () => {
    const { data, schema } = infer(
      page([
        txt('Invoice No:', 40, 800),
        txt('INV-1024', 130, 800),
        txt('Date:', 40, 780),
        txt('2024-05-01', 130, 780),
      ]),
    );
    expect(data['invoice_no']).toBe('INV-1024');
    expect(data['date']).toBe('2024-05-01');
    const date = schema.fields.find((f) => f.path === 'date');
    expect(date?.kind).toBe('date');
  });

  it('keeps the first occurrence of a repeated path stable', () => {
    const { data } = infer(
      page([
        txt('Name:', 40, 800),
        txt('Ada', 130, 800),
        txt('Name:', 40, 780),
        txt('Grace', 130, 780),
      ]),
    );
    expect(data['name']).toBe('Ada');
  });
});

describe('inferData — tables', () => {
  it('names columns from a header row and lists body rows under items', () => {
    const texts: ExtractedText[] = [
      // header row (non-field text)
      txt('Item', 40, 720),
      txt('Qty', 300, 720),
      txt('Price', 420, 720),
    ];
    // two data rows aligned to the same columns
    for (const y of [700, 680]) {
      texts.push(txt('widget', 40, y));
      texts.push(txt('2', 300, y));
      texts.push(txt('1,000', 420, y));
    }
    const { data, schema } = infer(page(texts));
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0]!.path).toBe('items');
    expect(schema.tables[0]!.columns).toEqual(['item', 'qty', 'price']);
    const rows = data['items'] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ item: 'widget', qty: '2', price: '1,000' });
  });

  it('falls back to positional column keys when there is no header', () => {
    const texts: ExtractedText[] = [];
    // all rows look like data (numeric cells) → no header
    for (const y of [720, 700, 680]) {
      texts.push(txt('9', 40, y));
      texts.push(txt('1,000', 300, y));
    }
    const { data, schema } = infer(page(texts));
    expect(schema.tables[0]!.columns).toEqual(['col1', 'col2']);
    const rows = data['items'] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ col1: '9', col2: '1,000' });
  });
});
