/**
 * Structured, locale-aware value formatting applied to a {@link DataField}
 * (§9). The descriptor's `kind` selects the family; `locale` optionally
 * overrides the element's effective locale (language/digits/calendar); `options`
 * carries family-specific settings. All formatting is symmetric across Persian
 * and English.
 */
import type { Calendar, DigitSystem, Language } from './locale';

export type FormatKind = 'text' | 'number' | 'currency' | 'percent' | 'date' | 'custom';

/** Per-format locale override (any subset; unset fields inherit the element). */
export interface FormatLocaleOverride {
  language?: Language;
  digits?: DigitSystem;
  calendar?: Calendar;
}

export interface NumberFormatOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
}

export interface CurrencyFormatOptions extends NumberFormatOptions {
  /** ISO 4217 code or a free symbol (e.g. `"IRR"`, `"﷼"`, `"$"`). */
  currency: string;
  currencyDisplay?: 'symbol' | 'code' | 'name';
}

export interface DateFormatOptions {
  /** Token pattern in the date library's vocabulary (ADR-0002). */
  pattern: string;
}

/** A printf/mask-style custom pattern (e.g. `"###-##-####"`). */
export interface CustomFormatOptions {
  mask: string;
}

export type FormatOptions =
  | NumberFormatOptions
  | CurrencyFormatOptions
  | DateFormatOptions
  | CustomFormatOptions
  | Record<string, never>;

export interface FormatDescriptor {
  kind: FormatKind;
  locale?: FormatLocaleOverride;
  options?: FormatOptions;
}
