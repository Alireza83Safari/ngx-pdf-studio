import { getBaseDirection, getVisualRuns, reorderToVisual } from './bidi';

describe('bidi (UAX #9, ADR-0003)', () => {
  it('detects base direction from the first strong character', () => {
    expect(getBaseDirection('hello world')).toBe('ltr');
    expect(getBaseDirection('سلام دنیا')).toBe('rtl');
    expect(getBaseDirection('a سلام')).toBe('ltr'); // first strong is Latin
    expect(getBaseDirection('سلام a')).toBe('rtl'); // first strong is Persian
  });

  it('treats neutral/numeric-only text as ltr', () => {
    expect(getBaseDirection('123 456')).toBe('ltr');
    expect(getBaseDirection('')).toBe('ltr');
  });

  it('respects an explicit base override', () => {
    expect(getBaseDirection('123', 'rtl')).toBe('rtl');
  });

  it('reorders a pure-RTL run to visual order (reversed)', () => {
    // Logical ا ب ج → visual ج ب ا
    expect(reorderToVisual('ابج')).toBe('جبا');
  });

  it('leaves pure-LTR text unchanged', () => {
    expect(reorderToVisual('abc')).toBe('abc');
  });

  it('keeps an embedded LTR word in order inside RTL text', () => {
    // The Latin word "OK" stays left-to-right within the reordered line.
    expect(reorderToVisual('سلام OK')).toContain('OK');
  });
});

describe('getVisualRuns (bidi run segmentation for drawing)', () => {
  it('returns a single LTR run for Latin text', () => {
    expect(getVisualRuns('abc')).toEqual([{ text: 'abc', rtl: false }]);
  });

  it('returns a single RTL run (logical order preserved for shaping)', () => {
    expect(getVisualRuns('سلام')).toEqual([{ text: 'سلام', rtl: true }]);
  });

  it('splits mixed text into runs with correct directions', () => {
    const runs = getVisualRuns('abc ابج');
    const ltr = runs.find((r) => !r.rtl);
    const rtl = runs.find((r) => r.rtl);
    expect(ltr?.text).toContain('abc');
    expect(rtl?.text).toContain('ابج');
  });

  it('isolates a Latin/number run embedded inside RTL text', () => {
    const runs = getVisualRuns('سلام 123');
    expect(runs.some((r) => !r.rtl && r.text.includes('123'))).toBe(true);
    expect(runs.some((r) => r.rtl && r.text.includes('سلام'))).toBe(true);
    // Every original character survives across the runs.
    expect(
      runs
        .map((r) => r.text)
        .join('')
        .replace(/\s/g, ''),
    ).toContain('سلام');
  });

  it('returns nothing for empty text', () => {
    expect(getVisualRuns('')).toEqual([]);
  });
});
