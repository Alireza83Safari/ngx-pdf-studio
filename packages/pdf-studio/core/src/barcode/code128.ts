/**
 * Code 128 barcode encoder (§5, §12). Code 128 encodes the full ASCII range at
 * high density with a mandatory mod-103 checksum. This encoder auto-selects the
 * most compact valid representation for the two common cases:
 *
 *  - all-digit, even-length values → Code C (two digits per symbol);
 *  - everything else → Code B (one ASCII printable per symbol, 32–126).
 *
 * Mid-string code-set switching (e.g. digit runs inside text) is a future
 * density optimization; the output here is always a valid, scannable symbol.
 * Values with characters outside Code B's range return `[]`, which the layout
 * treats as a non-fatal skip (§9).
 *
 * Returns a flat module-bit array (`true` = bar). Each of the 108 symbols is a
 * run-length pattern of 6 elements (bar/space/…) summing to 11 modules; the stop
 * symbol is 13 modules (7 elements). The painter draws each module as an
 * equal-width vertical slice.
 */
const START_B = 104;
const START_C = 105;
const STOP = 106;
const QUIET_ZONE_MODULES = 10;

/** Element widths per symbol value 0–106 (index = value); 106 is the stop. */
export const CODE128_PATTERNS: readonly string[] = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];

function pushSymbol(bits: boolean[], value: number): void {
  const pattern = CODE128_PATTERNS[value];
  if (!pattern) return;
  let on = true; // each symbol begins with a bar
  for (const ch of pattern) {
    const width = Number(ch);
    for (let i = 0; i < width; i++) bits.push(on);
    on = !on;
  }
}

export function encodeCode128(value: string): boolean[] {
  const numericEven = value.length > 0 && value.length % 2 === 0 && /^\d+$/.test(value);
  const codes: number[] = [];

  if (numericEven) {
    codes.push(START_C);
    for (let i = 0; i < value.length; i += 2) codes.push(Number(value.slice(i, i + 2)));
  } else {
    codes.push(START_B);
    for (const ch of value) {
      const v = ch.charCodeAt(0) - 32;
      if (v < 0 || v > 94) return []; // outside Code B printable range → skip
      codes.push(v);
    }
  }

  // Mod-103 checksum: start weight 1, each data symbol weighted by its position.
  let sum = codes[0] as number;
  for (let i = 1; i < codes.length; i++) sum += (codes[i] as number) * i;
  codes.push(sum % 103);
  codes.push(STOP);

  const bits: boolean[] = [];
  for (let i = 0; i < QUIET_ZONE_MODULES; i++) bits.push(false);
  for (const code of codes) pushSymbol(bits, code);
  for (let i = 0; i < QUIET_ZONE_MODULES; i++) bits.push(false);
  return bits;
}
