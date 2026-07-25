import type { ExtractedPage, ExtractedText } from './types';
import { classifyPage, detectValueKind, keyFromLabel, looksLikeLabel } from './classify';

function txt(text: string, x: number, y: number, over: Partial<ExtractedText> = {}): ExtractedText {
  return { text, x, y, dir: 'ltr', fontSize: 10, width: text.length * 5, ...over };
}

function page(texts: ExtractedText[]): ExtractedPage {
  return { width: 595, height: 842, texts, segments: [], rects: [], warnings: [] };
}

describe('detectValueKind', () => {
  it('recognizes dates in both orders and Persian digits', () => {
    expect(detectValueKind('1403/05/01')).toBe('date');
    expect(detectValueKind('01-05-1403')).toBe('date');
    expect(detectValueKind('۱۴۰۳/۰۵/۰۱')).toBe('date');
  });

  it('separates currency from plain numbers', () => {
    expect(detectValueKind('42,000,000')).toBe('currency');
    expect(detectValueKind('12,500 ریال')).toBe('currency');
    expect(detectValueKind('$1,299.00')).toBe('currency');
    expect(detectValueKind('42')).toBe('number');
    expect(detectValueKind('3.14')).toBe('number');
  });

  it('recognizes percent, email, phone, and IBAN', () => {
    expect(detectValueKind('18%')).toBe('percent');
    expect(detectValueKind('user@example.com')).toBe('email');
    expect(detectValueKind('09121234567')).toBe('phone');
    expect(detectValueKind('IR062960000000100324200001')).toBe('iban');
  });

  it('returns null for plain prose', () => {
    expect(detectValueKind('فاکتور فروش')).toBeNull();
    expect(detectValueKind('Customer Name')).toBeNull();
    expect(detectValueKind('')).toBeNull();
  });
});

describe('labels', () => {
  it('detects colon labels and derives ASCII keys', () => {
    expect(looksLikeLabel('Invoice No:')).toBe(true);
    expect(looksLikeLabel('شماره فاکتور:')).toBe(true);
    expect(looksLikeLabel('just text')).toBe(false);
    expect(keyFromLabel('Invoice No:')).toBe('invoice_no');
    expect(keyFromLabel('Total Amount :')).toBe('total_amount');
    expect(keyFromLabel('شماره:')).toBeNull(); // all-Persian → no ascii key
  });
});

describe('classifyPage — label:value pairing', () => {
  it('pairs an LTR label with the value to its right', () => {
    const p = page([
      txt('Invoice No:', 40, 800),
      txt('INV-1024', 130, 800),
      txt('Date:', 40, 780),
      txt('2024-05-01', 130, 780),
    ]);
    const { texts } = classifyPage(p);
    expect(texts[0]).toMatchObject({ role: 'label', valueIndex: 1 });
    expect(texts[1]).toMatchObject({ role: 'field', fieldPath: 'invoice_no' });
    expect(texts[3]).toMatchObject({ role: 'field', kind: 'date', fieldPath: 'date' });
  });

  it('pairs an RTL label with the value to its left', () => {
    // reading right→left: label at higher x, value at lower x, same row
    const p = page([
      txt('شماره فاکتور:', 400, 800, { dir: 'rtl' }),
      txt('۱۰۲۴', 300, 800, { dir: 'rtl' }),
    ]);
    const { texts } = classifyPage(p);
    expect(texts[0]!.role).toBe('label');
    expect(texts[0]!.valueIndex).toBe(1);
    expect(texts[1]!.role).toBe('field');
    // all-Persian label → fallback path keyed by kind/counter
    expect(texts[1]!.fieldPath).toBeTruthy();
  });

  it('leaves prose runs as static', () => {
    const p = page([txt('Thank you for your business', 40, 700)]);
    expect(classifyPage(p).texts[0]!.role).toBe('static');
  });
});

describe('classifyPage — table detection', () => {
  it('groups aligned repeating rows into a table region', () => {
    const rows = [720, 700, 680];
    const texts: ExtractedText[] = [];
    for (const y of rows) {
      texts.push(txt('item', 40, y));
      texts.push(txt('2', 300, y));
      texts.push(txt('1,000', 420, y));
    }
    const { tables } = classifyPage(page(texts));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.columns).toHaveLength(3);
    expect(tables[0]!.rows).toHaveLength(3);
  });

  it('does not treat a single row as a table', () => {
    const p = page([txt('a', 40, 720), txt('b', 300, 720), txt('c', 420, 720)]);
    expect(classifyPage(p).tables).toHaveLength(0);
  });

  it('does not pair aligned data-table cells as label:value', () => {
    // a genuine (colon-free) data table must stay a table, not a form
    const texts: ExtractedText[] = [];
    for (const y of [720, 700, 680]) {
      texts.push(txt('widget', 40, y));
      texts.push(txt('3', 300, y));
      texts.push(txt('1,500', 420, y));
    }
    const { texts: cls, tables } = classifyPage(page(texts));
    expect(tables).toHaveLength(1);
    expect(cls.every((c) => c.role !== 'label')).toBe(true);
  });

  it('prefers a two-column colon form over a table', () => {
    // aligned columns, but each left cell is a colon label → form, not table
    const p = page([
      txt('Name:', 40, 720),
      txt('Ada', 130, 720),
      txt('City:', 40, 700),
      txt('Paris', 130, 700),
    ]);
    const { texts, tables } = classifyPage(p);
    expect(tables).toHaveLength(0);
    expect(texts[0]!.role).toBe('label');
    expect(texts[1]).toMatchObject({ role: 'field', fieldPath: 'name' });
    expect(texts[3]).toMatchObject({ role: 'field', fieldPath: 'city' });
  });
});
