import { applyFormat } from './format-value';
import type { LocaleSetup } from '../model/locale';

const FA: LocaleSetup = { language: 'fa', digits: 'persian', calendar: 'jalali' };
const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

describe("money format (kind: 'money', ROADMAP ۱.۳)", () => {
  it('groups thousands, drops decimals, and appends ریال by default', () => {
    expect(applyFormat(4850000, { kind: 'money' }, FA).text).toBe('۴٬۸۵۰٬۰۰۰ ریال');
  });

  it('supports تومان and custom unit suffixes', () => {
    expect(applyFormat(1500, { kind: 'money', options: { unit: 'toman' } }, FA).text).toBe(
      '۱٬۵۰۰ تومان',
    );
    expect(applyFormat(9, { kind: 'money', options: { unit: 'دلار' } }, FA).text).toBe('۹ دلار');
  });

  it('renders accounting negatives in parentheses when asked', () => {
    expect(
      applyFormat(-12345, { kind: 'money', options: { negativeParentheses: true } }, FA).text,
    ).toBe('(۱۲٬۳۴۵) ریال');
    expect(applyFormat(-12345, { kind: 'money' }, FA).text).toBe('-۱۲٬۳۴۵ ریال');
  });

  it('rounds to whole units by default but honors fraction options', () => {
    expect(applyFormat(10.75, { kind: 'money' }, EN).text).toBe('11 ریال');
    expect(
      applyFormat(10.75, { kind: 'money', options: { maximumFractionDigits: 2 } }, EN).text,
    ).toBe('10.75 ریال');
  });

  it('falls back gracefully for non-numeric values', () => {
    expect(applyFormat('n/a', { kind: 'money' }, EN).text).toBe('n/a');
  });
});
