import { EAN13_G, EAN13_L, EAN13_PARITY, EAN13_R, ean13CheckDigit, encodeEan13 } from './ean13';
import { createDefaultBarcodes } from './registry';

// --- a minimal EAN-13 decoder to round-trip the encoder (correctness, §13) ---

function trimQuiet(bits: boolean[]): boolean[] {
  let s = 0;
  let e = bits.length;
  while (s < e && !bits[s]) s++;
  while (e > s && !bits[e - 1]) e--;
  return bits.slice(s, e);
}

const toPattern = (bits: boolean[]): string => bits.map((b) => (b ? '1' : '0')).join('');

function decodeEan13(bits: boolean[]): { value: string; checkOk: boolean } {
  const core = trimQuiet(bits);
  let p = 3; // skip start guard 101
  const leftDigits: number[] = [];
  let parity = '';
  for (let i = 0; i < 6; i++, p += 7) {
    const chunk = toPattern(core.slice(p, p + 7));
    const lIdx = EAN13_L.indexOf(chunk);
    const gIdx = EAN13_G.indexOf(chunk);
    if (lIdx >= 0) {
      leftDigits.push(lIdx);
      parity += 'L';
    } else {
      leftDigits.push(gIdx);
      parity += 'G';
    }
  }
  p += 5; // skip center guard 01010
  const rightDigits: number[] = [];
  for (let i = 0; i < 6; i++, p += 7) {
    rightDigits.push(EAN13_R.indexOf(toPattern(core.slice(p, p + 7))));
  }
  const lead = EAN13_PARITY.indexOf(parity);
  const digits = [lead, ...leftDigits, ...rightDigits];
  const checkOk = ean13CheckDigit(digits.slice(0, 12)) === digits[12];
  return { value: digits.join(''), checkOk };
}

describe('EAN-13 encoder (§5)', () => {
  it('round-trips a 12-digit value, appending the computed check digit', () => {
    const bits = encodeEan13('590123412345'); // known check digit is 7
    const decoded = decodeEan13(bits);
    expect(decoded.value).toBe('5901234123457');
    expect(decoded.checkOk).toBe(true);
  });

  it('accepts a full 13-digit value with a valid check digit', () => {
    expect(decodeEan13(encodeEan13('5901234123457')).value).toBe('5901234123457');
  });

  it('rejects a 13-digit value with a bad check digit', () => {
    expect(encodeEan13('5901234123450')).toEqual([]);
  });

  it('rejects non-numeric or wrong-length input', () => {
    expect(encodeEan13('12345')).toEqual([]);
    expect(encodeEan13('abcdefghijkl')).toEqual([]);
  });

  it('is registered as a built-in symbology', () => {
    const reg = createDefaultBarcodes();
    expect(reg.has('ean13')).toBe(true);
    expect(decodeEan13(reg.encode('ean13', '400638133393')!).checkOk).toBe(true);
  });
});
