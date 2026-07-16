import { createRenderContext } from '../binding/render-context';
import { evaluateExpr } from '../binding/evaluate';
import { Scope } from '../expression/scope';
import { numberToPersianWords } from './number-words';

describe('numberToPersianWords (ROADMAP ۱.۱)', () => {
  const cases: Array<[number, string]> = [
    [0, 'صفر'],
    [1, 'یک'],
    [7, 'هفت'],
    [10, 'ده'],
    [14, 'چهارده'],
    [19, 'نوزده'],
    [20, 'بیست'],
    [21, 'بیست و یک'],
    [99, 'نود و نه'],
    [100, 'صد'],
    [110, 'صد و ده'],
    [315, 'سیصد و پانزده'],
    [1000, 'یک هزار'],
    [1100, 'یک هزار و صد'],
    [2024, 'دو هزار و بیست و چهار'],
    [86500, 'هشتاد و شش هزار و پانصد'],
    [4850000, 'چهار میلیون و هشتصد و پنجاه هزار'],
    [1000000007, 'یک میلیارد و هفت'],
    [1200000000000, 'یک هزار میلیارد و دویست میلیارد'],
  ];
  it.each(cases)('%d → %s', (n, expected) => {
    expect(numberToPersianWords(n)).toBe(expected);
  });

  it('reads negatives with منفی', () => {
    expect(numberToPersianWords(-42)).toBe('منفی چهل و دو');
  });

  it('reads decimals with ممیز and the fractional unit', () => {
    expect(numberToPersianWords(12.35)).toBe('دوازده ممیز سی و پنج صدم');
    expect(numberToPersianWords(0.5)).toBe('صفر ممیز پنج دهم');
    expect(numberToPersianWords(3.007)).toBe('سه ممیز هفت هزارم');
  });

  it('appends currency suffixes', () => {
    expect(numberToPersianWords(4850000, { currency: 'rial' })).toBe(
      'چهار میلیون و هشتصد و پنجاه هزار ریال',
    );
    expect(numberToPersianWords(500, { currency: 'toman' })).toBe('پانصد تومان');
    expect(numberToPersianWords(9, { currency: 'دلار' })).toBe('نه دلار');
  });

  it('returns empty for non-finite input', () => {
    expect(numberToPersianWords(Number.NaN)).toBe('');
    expect(numberToPersianWords(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('toWords() expression function', () => {
  const evalIn = (src: string, data: Record<string, unknown> = {}) => {
    const ctx = createRenderContext({ data });
    return {
      value: evaluateExpr(src, Scope.create({ data: ctx.data }), ctx, 'latn'),
      diags: ctx.diagnostics,
    };
  };

  it('converts bound values', () => {
    const r = evalIn('toWords(total)', { total: 4850000 });
    expect(r.value).toBe('چهار میلیون و هشتصد و پنجاه هزار');
    expect(r.diags).toHaveLength(0);
  });

  it("accepts a currency shorthand: toWords(x, 'rial')", () => {
    expect(evalIn("toWords(1500, 'rial')").value).toBe('یک هزار و پانصد ریال');
    expect(evalIn("toWords(1500, 'toman')").value).toBe('یک هزار و پانصد تومان');
  });

  it('composes with arithmetic', () => {
    expect(
      evalIn("toWords(sum(items, qty * price), 'rial')", {
        items: [
          { qty: 2, price: 100 },
          { qty: 1, price: 50 },
        ],
      }).value,
    ).toBe('دویست و پنجاه ریال');
  });

  it('is graceful on bad input', () => {
    expect(evalIn("toWords('abc')").value).toBe('');
  });
});
