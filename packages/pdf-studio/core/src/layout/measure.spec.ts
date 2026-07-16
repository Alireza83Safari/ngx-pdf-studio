import { SimpleTextMeasurer } from './measure';

describe('SimpleTextMeasurer', () => {
  const m = new SimpleTextMeasurer();

  it('measures a single line without wrapping when no width is given', () => {
    const out = m.measure('hello', { fontSize: 10 });
    expect(out.lines).toEqual(['hello']);
    expect(out.width).toBeCloseTo(5 * 10 * 0.5, 5);
    expect(out.height).toBeCloseTo(10 * 1.2, 5);
  });

  it('honors explicit line breaks', () => {
    expect(m.measure('a\nb\nc', { fontSize: 10 }).lines).toEqual(['a', 'b', 'c']);
  });

  it('wraps on word boundaries to fit a max width', () => {
    const out = m.measure('aa bb cc dd', { fontSize: 10 }, 30); // ~6 chars/line
    expect(out.lines.length).toBeGreaterThan(1);
  });

  it('hard-breaks a single token longer than the line', () => {
    const out = m.measure('x'.repeat(20), { fontSize: 10 }, 30);
    expect(out.lines.length).toBeGreaterThan(1);
    expect(out.lines.every((l) => l.length <= 6)).toBe(true);
  });

  it('returns a single empty line for empty input', () => {
    expect(m.measure('', { fontSize: 10 }, 50).lines).toEqual(['']);
  });
});
