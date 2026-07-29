/**
 * Measured against the **bundled** Vazirmatn (OFL), not a system font: this is
 * the measurer every PDF render goes through, so its tests must run everywhere
 * — CI, Windows, macOS — rather than only on a Linux box that happens to ship
 * DejaVu. (They previously guarded a system path with `existsSync`, which never
 * worked: `describe.skip` still executes the callback body, so the `readFileSync`
 * threw and took the whole suite down off-Linux.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FontkitTextMeasurer } from './fontkit-measurer';
import { SimpleTextMeasurer } from './measure';

const VAZIRMATN = join(__dirname, '../../../pdf/fonts/vazirmatn/Vazirmatn-Regular.ttf');

describe('FontkitTextMeasurer (real metrics, ADR-0003)', () => {
  const bytes = new Uint8Array(readFileSync(VAZIRMATN));
  const measurer = new FontkitTextMeasurer([{ family: 'Vazirmatn', bytes }]);

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
    // The bundled Vazirmatn reports 156.25 (≈1.56em): Arabic-script faces
    // reserve far more vertical room than a Latin one (DejaVu is ≈1.16em),
    // which is exactly why measuring the *real* font matters. Asserted as a
    // band rather than the exact figure so a font upgrade that nudges the
    // metrics reports as a font change, not as a mystery failure here.
    expect(height).toBeGreaterThan(140);
    expect(height).toBeLessThan(170);
  });

  it('honors an explicit line-height multiplier', () => {
    expect(measurer.measure('x', { fontSize: 10, lineHeight: 2 }).height).toBeCloseTo(20, 4);
  });

  it('wraps text to a max width using real widths', () => {
    const out = measurer.measure('the quick brown fox jumps', { fontSize: 12 }, 60);
    expect(out.lines.length).toBeGreaterThan(1);
    expect(out.width).toBeLessThanOrEqual(60);
  });

  it('hard-breaks a single word that is wider than the cap', () => {
    // No space to break on, so the wrapper must split mid-word rather than
    // emit one line that overflows the column.
    const out = measurer.measure('supercalifragilistic', { fontSize: 12 }, 30);
    expect(out.lines.length).toBeGreaterThan(1);
    expect(out.width).toBeLessThanOrEqual(30);
    expect(out.lines.join('')).toBe('supercalifragilistic');
  });

  it('breaks an over-long word that follows a fitting one', () => {
    const out = measurer.measure('hi supercalifragilistic', { fontSize: 12 }, 30);
    expect(out.lines[0]).toBe('hi');
    expect(out.lines.slice(1).join('')).toBe('supercalifragilistic');
  });

  it('keeps hard newlines and measures the widest line', () => {
    const out = measurer.measure('i\nWWWW', { fontSize: 12 });
    expect(out.lines).toEqual(['i', 'WWWW']);
    expect(out.width).toBeCloseTo(measurer.measure('WWWW', { fontSize: 12 }).width, 4);
  });

  it('measures empty text as zero width', () => {
    expect(measurer.measure('', { fontSize: 12 }).width).toBe(0);
  });

  it('wraps Persian text on word boundaries', () => {
    const out = measurer.measure('سلام دنیا', { fontSize: 12 }, 40);
    expect(out.lines).toEqual(['سلام', 'دنیا']);
  });

  it('falls back to the first font when the requested family is unknown', () => {
    const known = measurer.measure('Hello', { fontSize: 12, fontFamily: 'Vazirmatn' }).width;
    expect(measurer.measure('Hello', { fontSize: 12, fontFamily: 'Nonesuch' }).width).toBe(known);
  });

  it('requires at least one font', () => {
    expect(() => new FontkitTextMeasurer([])).toThrow(/at least one font/);
  });
});
