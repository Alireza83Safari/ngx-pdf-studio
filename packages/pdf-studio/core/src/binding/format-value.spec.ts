import type { LocaleSetup } from '../model/locale';
import { applyFormat } from './format-value';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const FA: LocaleSetup = { language: 'fa', digits: 'persian', calendar: 'jalali' };

describe('applyFormat (§9)', () => {
  it('returns empty string for null/undefined', () => {
    expect(applyFormat(null, undefined, EN).text).toBe('');
    expect(applyFormat(undefined, { kind: 'number' }, EN).text).toBe('');
  });

  it('formats numbers with grouping and the effective digit system', () => {
    expect(applyFormat(1234.5, { kind: 'number' }, EN).text).toBe('1,234.5');
    expect(applyFormat(1234.5, { kind: 'number' }, FA).text).toBe('۱٬۲۳۴٫۵');
  });

  it('formats currency and percent', () => {
    expect(applyFormat(1234.5, { kind: 'currency', options: { currency: '﷼' } }, EN).text).toBe(
      '1,234.5 ﷼',
    );
    expect(applyFormat(0.25, { kind: 'percent' }, EN).text).toBe('25%');
  });

  it('formats Gregorian dates with a token pattern (UTC, deterministic)', () => {
    const out = applyFormat(
      '2026-06-24T08:30:00Z',
      { kind: 'date', options: { pattern: 'yyyy/MM/dd HH:mm' } },
      EN,
    );
    expect(out.text).toBe('2026/06/24 08:30');
  });

  it('formats Jalali dates with Persian digits (no warning)', () => {
    const out = applyFormat(
      '2026-06-24T00:00:00Z',
      { kind: 'date', options: { pattern: 'yyyy/MM/dd' } },
      FA,
    );
    expect(out.text).toBe('۱۴۰۵/۰۴/۰۳'); // 2026-06-24 → 1405/04/03 Jalali
    expect(out.warning).toBeUndefined();
  });

  it('applies digit conversion to plain text too', () => {
    expect(applyFormat('A1B2', { kind: 'text' }, FA).text).toBe('A۱B۲');
  });

  it('passes through non-numeric values given a numeric format', () => {
    expect(applyFormat('n/a', { kind: 'number' }, EN).text).toBe('n/a');
  });

  it('passes through unparseable dates', () => {
    expect(applyFormat('not-a-date', { kind: 'date' }, EN).text).toBe('not-a-date');
  });

  it('honors a per-descriptor calendar override (Gregorian base → Jalali field)', () => {
    const out = applyFormat(
      '2026-06-24T00:00:00Z',
      { kind: 'date', options: { pattern: 'yyyy' }, locale: { calendar: 'jalali' } },
      EN,
    );
    expect(out.text).toBe('1405'); // Jalali year, Latin digits (base locale en)
  });
});
