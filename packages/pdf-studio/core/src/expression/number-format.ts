/**
 * Deterministic, locale-aware number formatting (§9). Implemented by hand rather
 * than via `Intl` so output is byte-identical across browser and Node
 * regardless of the runtime's ICU version (§3 parity requirement). Grouping uses
 * a thin space-free comma for Latin and the Arabic thousands separator for
 * Persian, with the Arabic decimal separator for Persian digits.
 */
import { toPersianDigits } from './digits';
import type { DigitSystem } from '../model/locale';

export interface NumberFormatSettings {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
  digits: DigitSystem;
}

const PERSIAN_GROUP_SEP = '٬';
const PERSIAN_DECIMAL_SEP = '٫';

/** Format a finite number to a string per the given settings. */
export function formatNumberValue(value: number, settings: NumberFormatSettings): string {
  const maxFrac = clamp(settings.maximumFractionDigits ?? 3, 0, 20);
  const minFrac = clamp(settings.minimumFractionDigits ?? 0, 0, maxFrac);
  const useGrouping = settings.useGrouping !== false;

  const negative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);

  // Round to maxFrac, then trim trailing zeros down to minFrac.
  const fixed = abs.toFixed(maxFrac);
  const dot = fixed.indexOf('.');
  let intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  let fracPart = dot === -1 ? '' : fixed.slice(dot + 1);
  while (fracPart.length > minFrac && fracPart.endsWith('0')) {
    fracPart = fracPart.slice(0, -1);
  }

  const isPersian = settings.digits === 'persian';
  if (useGrouping) intPart = group(intPart, isPersian ? PERSIAN_GROUP_SEP : ',');

  const decimalSep = isPersian ? PERSIAN_DECIMAL_SEP : '.';
  let out = fracPart.length ? `${intPart}${decimalSep}${fracPart}` : intPart;
  if (negative && Number(fixed) !== 0) out = `-${out}`;

  // toPersianDigits only rewrites digit code points; the Persian separators
  // chosen above are preserved untouched.
  return isPersian ? toPersianDigits(out) : out;
}

function group(intDigits: string, sep: string): string {
  let result = '';
  for (let i = 0; i < intDigits.length; i++) {
    if (i > 0 && (intDigits.length - i) % 3 === 0) result += sep;
    result += intDigits[i];
  }
  return result;
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(n)));
