import { createDefaultBarcodes } from './registry';
import { encodeCode39, isCode39Encodable } from './code39';

describe('Code 39 encoder (§5)', () => {
  it('frames the value with the * start/stop pattern and quiet zones', () => {
    const bits = encodeCode39('A');
    // Leading + trailing quiet zone of 10 false modules.
    expect(bits.slice(0, 10).every((b) => !b)).toBe(true);
    expect(bits.slice(-10).every((b) => !b)).toBe(true);
    // Bars exist between the quiet zones.
    expect(bits.some((b) => b)).toBe(true);
  });

  it('is deterministic and length-stable for the same input', () => {
    expect(encodeCode39('HELLO')).toEqual(encodeCode39('HELLO'));
  });

  it('uppercases input and encodes more modules for longer values', () => {
    expect(encodeCode39('abc')).toEqual(encodeCode39('ABC'));
    expect(encodeCode39('ABCDEF').length).toBeGreaterThan(encodeCode39('AB').length);
  });

  it('reports encodability (rejects the reserved * and unknown chars)', () => {
    expect(isCode39Encodable('INVOICE-2026')).toBe(true);
    expect(isCode39Encodable('a*b')).toBe(false);
    expect(isCode39Encodable('café')).toBe(false);
  });

  it('skips unknown characters rather than throwing', () => {
    expect(() => encodeCode39('A é B')).not.toThrow();
  });
});

describe('BarcodeRegistry (§12)', () => {
  it('encodes via the built-in code39 and returns undefined for unknown symbologies', () => {
    const reg = createDefaultBarcodes();
    expect(reg.encode('code39', '123')).toBeInstanceOf(Array);
    expect(reg.encode('aztec', '123')).toBeUndefined();
  });

  it('is extensible and clone-isolated', () => {
    const reg = createDefaultBarcodes();
    const clone = reg.clone();
    clone.register('custom', () => [true, false, true]);
    expect(clone.encode('custom', 'x')).toEqual([true, false, true]);
    expect(reg.has('custom')).toBe(false);
  });
});
