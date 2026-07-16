import { CODE128_PATTERNS, encodeCode128 } from './code128';
import { createDefaultBarcodes } from './registry';

// --- a minimal Code 128 decoder, to round-trip the encoder (correctness, §13) ---

/** Trim the false (quiet-zone) modules from both ends. */
function trimQuiet(bits: boolean[]): boolean[] {
  let s = 0;
  let e = bits.length;
  while (s < e && !bits[s]) s++;
  while (e > s && !bits[e - 1]) e--;
  return bits.slice(s, e);
}

/** Run-length encode a symbol window into its width pattern string. */
function widths(bits: boolean[]): string {
  let out = '';
  let i = 0;
  while (i < bits.length) {
    let j = i;
    while (j < bits.length && bits[j] === bits[i]) j++;
    out += String(j - i);
    i = j;
  }
  return out;
}

interface Decoded {
  value: string;
  checksumOk: boolean;
  stopOk: boolean;
}

function decodeCode128(bits: boolean[]): Decoded {
  const core = trimQuiet(bits);
  const values: number[] = [];
  let p = 0;
  // Every symbol is 11 modules except the trailing 13-module stop.
  while (core.length - p > 13) {
    values.push(CODE128_PATTERNS.indexOf(widths(core.slice(p, p + 11))));
    p += 11;
  }
  const stopVal = CODE128_PATTERNS.indexOf(widths(core.slice(p)));

  const start = values[0] as number;
  const checksum = values[values.length - 1] as number;
  const data = values.slice(1, -1);

  let sum = start;
  for (let i = 0; i < data.length; i++) sum += (data[i] as number) * (i + 1);

  let value = '';
  if (start === 105) {
    for (const v of data) value += String(v).padStart(2, '0'); // Code C
  } else {
    for (const v of data) value += String.fromCharCode(v + 32); // Code B
  }
  return { value, checksumOk: sum % 103 === checksum, stopOk: stopVal === 106 };
}

describe('Code 128 encoder (§5)', () => {
  it('round-trips an alphanumeric value via Code B with a valid checksum', () => {
    const bits = encodeCode128('PDF-128');
    const decoded = decodeCode128(bits);
    expect(decoded.value).toBe('PDF-128');
    expect(decoded.checksumOk).toBe(true);
    expect(decoded.stopOk).toBe(true);
  });

  it('uses compact Code C for even-length digit strings', () => {
    const cBits = encodeCode128('123456');
    const decoded = decodeCode128(cBits);
    expect(decoded.value).toBe('123456');
    expect(decoded.checksumOk).toBe(true);
    // Code C packs 2 digits/symbol, so it is shorter than the Code B encoding.
    const odd = encodeCode128('12345'); // odd length → Code B
    expect(cBits.length).toBeLessThan(odd.length);
  });

  it('returns empty bits for characters outside Code B', () => {
    expect(encodeCode128('café')).toEqual([]); // 'é' is out of range
  });

  it('is registered as a built-in symbology', () => {
    const reg = createDefaultBarcodes();
    expect(reg.has('code128')).toBe(true);
    expect(decodeCode128(reg.encode('code128', 'ABC123')!).value).toBe('ABC123');
  });
});
