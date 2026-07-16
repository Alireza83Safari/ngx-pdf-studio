/**
 * Numeral-system conversion (§9, §11). Both directions are first-class:
 * `toPersianDigits` / `toLatinDigits`. Only digit code points are touched;
 * surrounding text is preserved.
 */
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Map ASCII digits in `input` to Persian (Extended Arabic-Indic) digits. */
export function toPersianDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] as string);
}

/** Map Persian and Arabic-Indic digits in `input` back to ASCII digits. */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    // Extended Arabic-Indic (Persian) U+06F0..; Arabic-Indic U+0660..
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}
