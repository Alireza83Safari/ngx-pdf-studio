/**
 * EAN-13 barcode encoder (§5, §12). EAN-13 encodes 12 data digits plus a mod-10
 * check digit. The leading (system) digit is not drawn directly: it is carried
 * by the L/G parity pattern of the six left-hand digits. Layout is
 * `quiet | 101 | 6×left | 01010 | 6×right | 101 | quiet`, every digit 7 modules.
 *
 * Accepts 12 digits (the check digit is computed and appended) or 13 digits (the
 * check digit must be valid). Any other input returns `[]`, a non-fatal skip the
 * layout reports (§9). Returns a flat module-bit array (`true` = bar).
 */
const QUIET_ZONE_MODULES = 9;

// 7-module patterns per digit (1 = bar). L = odd parity, G = even, R = right.
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];

// Parity pattern of the six left digits, selected by the leading digit.
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

export { L as EAN13_L, G as EAN13_G, R as EAN13_R, PARITY as EAN13_PARITY };

/** EAN-13 mod-10 check digit over the first 12 digits. */
export function ean13CheckDigit(digits12: number[]): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (digits12[i] as number) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function pushPattern(bits: boolean[], pattern: string): void {
  for (const ch of pattern) bits.push(ch === '1');
}

export function encodeEan13(value: string): boolean[] {
  if (!/^\d{12,13}$/.test(value)) return [];
  const digits = value.split('').map(Number);
  const check = ean13CheckDigit(digits.slice(0, 12));
  if (digits.length === 13) {
    if (digits[12] !== check) return []; // invalid check digit
  } else {
    digits.push(check);
  }

  const lead = digits[0] as number;
  const parity = PARITY[lead] as string;
  const left = digits.slice(1, 7);
  const right = digits.slice(7, 13);

  const bits: boolean[] = [];
  for (let i = 0; i < QUIET_ZONE_MODULES; i++) bits.push(false);
  pushPattern(bits, '101'); // start guard
  left.forEach((d, i) => pushPattern(bits, (parity[i] === 'L' ? L : G)[d] as string));
  pushPattern(bits, '01010'); // center guard
  right.forEach((d) => pushPattern(bits, R[d] as string));
  pushPattern(bits, '101'); // end guard
  for (let i = 0; i < QUIET_ZONE_MODULES; i++) bits.push(false);
  return bits;
}
