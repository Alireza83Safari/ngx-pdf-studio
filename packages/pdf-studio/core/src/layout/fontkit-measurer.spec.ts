import { existsSync, readFileSync } from 'node:fs';
import { FontkitTextMeasurer } from './fontkit-measurer';
import { SimpleTextMeasurer } from './measure';

const DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const maybe = existsSync(DEJAVU) ? describe : describe.skip;

maybe('FontkitTextMeasurer (real metrics, ADR-0003)', () => {
  const bytes = new Uint8Array(readFileSync(DEJAVU));
  const measurer = new FontkitTextMeasurer([{ family: 'DejaVu Sans', bytes }]);

  it('uses proportional advance widths (narrow glyphs < wide glyphs)', () => {
    const iii = measurer.measure('iii', { fontSize: 20 }).width;
    const www = measurer.measure('WWW', { fontSize: 20 }).width;
    expect(iii).toBeLessThan(www);
    // The naive estimator cannot tell these apart — that is the parity gap closed.
    const simple = new SimpleTextMeasurer();
    expect(simple.measure('iii', { fontSize: 20 }).width).toBe(
      simple.measure('WWW', { fontSize: 20 }).width,
    );
  });

  it('scales linearly with font size', () => {
    const at10 = measurer.measure('Hello', { fontSize: 10 }).width;
    const at20 = measurer.measure('Hello', { fontSize: 20 }).width;
    expect(at20).toBeCloseTo(at10 * 2, 4);
  });

  it('derives a natural line height from ascent/descent when none is given', () => {
    const { height } = measurer.measure('x', { fontSize: 100 });
    expect(height).toBeGreaterThan(100);
    expect(height).toBeLessThan(140); // DejaVu ≈ 1.16em
  });

  it('honors an explicit line-height multiplier', () => {
    expect(measurer.measure('x', { fontSize: 10, lineHeight: 2 }).height).toBeCloseTo(20, 4);
  });

  it('wraps text to a max width using real widths', () => {
    const out = measurer.measure('the quick brown fox jumps', { fontSize: 12 }, 60);
    expect(out.lines.length).toBeGreaterThan(1);
    expect(out.width).toBeLessThanOrEqual(60 + 12); // within a word of the cap
  });
});
