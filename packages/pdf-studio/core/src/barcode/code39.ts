/**
 * Code 39 barcode encoder (§5). Code 39 is self-checking and needs no
 * Reed-Solomon/checksum, which makes it a clean, fully-testable built-in. Each
 * character is 9 elements (5 bars + 4 spaces) of narrow/wide width (3:1 ratio
 * here); characters are separated by one narrow space and the value is framed by
 * the `*` start/stop character. A quiet zone pads both ends so scanners lock on.
 *
 * Returns a flat array of module bits (`true` = bar). The painter draws each
 * module as an equal-width vertical slice across the element bounds.
 */
const WIDE = 3;
const NARROW = 1;
const QUIET_ZONE_MODULES = 10;

/** 9-element narrow/wide patterns; elements alternate bar/space starting bar. */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

/** True if `value` contains only Code 39-encodable characters. */
export function isCode39Encodable(value: string): boolean {
  return [...value.toUpperCase()].every((ch) => ch !== '*' && PATTERNS[ch] !== undefined);
}

function encodeChar(pattern: string): boolean[] {
  const bits: boolean[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const isBar = i % 2 === 0;
    const width = pattern[i] === 'w' ? WIDE : NARROW;
    for (let w = 0; w < width; w++) bits.push(isBar);
  }
  return bits;
}

/** Encode `value` to Code 39 module bits, framed by `*` and a quiet zone. */
export function encodeCode39(value: string): boolean[] {
  const chars = ['*', ...[...value.toUpperCase()].filter((ch) => ch !== '*' && PATTERNS[ch]), '*'];
  const bits: boolean[] = new Array<boolean>(QUIET_ZONE_MODULES).fill(false);
  chars.forEach((ch, index) => {
    bits.push(...encodeChar(PATTERNS[ch] as string));
    if (index < chars.length - 1) bits.push(false); // narrow inter-character gap
  });
  for (let i = 0; i < QUIET_ZONE_MODULES; i++) bits.push(false);
  return bits;
}
