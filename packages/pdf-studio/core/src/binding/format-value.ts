/**
 * Applies a {@link FormatDescriptor} to a bound value, producing a display
 * string (§9). Locale-aware and symmetric across Persian/English. Dates are
 * formatted via the calendar engine (Gregorian **and** Jalali, ADR-0002),
 * deterministically and timezone-independently.
 */
import { toPersianDigits } from '../expression/digits';
import { formatNumberValue } from '../expression/number-format';
import { formatDate } from '../i18n/calendar';
import type { FormatDescriptor } from '../model/format';
import type { LocaleSetup } from '../model/locale';

export interface FormatOutcome {
  text: string;
  warning?: string;
}

const mergeLocale = (base: LocaleSetup, d?: FormatDescriptor): LocaleSetup => {
  const o = d?.locale;
  if (!o) return base;
  return {
    language: o.language ?? base.language,
    digits: o.digits ?? base.digits,
    calendar: o.calendar ?? base.calendar,
  };
};

const applyDigits = (text: string, locale: LocaleSetup): string =>
  locale.digits === 'persian' ? toPersianDigits(text) : text;

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

/**
 * Format `value` per `descriptor` against the element's effective `locale`.
 * Returns the display text plus an optional non-fatal warning.
 */
export function applyFormat(
  value: unknown,
  descriptor: FormatDescriptor | undefined,
  baseLocale: LocaleSetup,
): FormatOutcome {
  if (value === null || value === undefined) return { text: '' };

  const locale = mergeLocale(baseLocale, descriptor);
  const kind = descriptor?.kind ?? 'text';
  const options = (descriptor?.options ?? {}) as Record<string, unknown>;

  switch (kind) {
    case 'number':
    case 'currency':
    case 'percent': {
      const raw = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(raw)) return { text: applyDigits(String(value), locale) };
      const n = kind === 'percent' ? raw * 100 : raw;
      let text = formatNumberValue(n, {
        digits: locale.digits,
        useGrouping: options['useGrouping'] !== false,
        ...(typeof options['minimumFractionDigits'] === 'number'
          ? { minimumFractionDigits: options['minimumFractionDigits'] }
          : {}),
        ...(typeof options['maximumFractionDigits'] === 'number'
          ? { maximumFractionDigits: options['maximumFractionDigits'] }
          : {}),
      });
      if (kind === 'percent') text = applyDigits(`${text}%`, locale);
      if (kind === 'currency' && typeof options['currency'] === 'string') {
        text = `${text} ${options['currency']}`;
      }
      return { text };
    }

    case 'money': {
      const raw = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(raw)) return { text: applyDigits(String(value), locale) };
      const negative = raw < 0;
      let text = formatNumberValue(Math.abs(raw), {
        digits: locale.digits,
        useGrouping: options['useGrouping'] !== false,
        minimumFractionDigits:
          typeof options['minimumFractionDigits'] === 'number'
            ? (options['minimumFractionDigits'] as number)
            : 0,
        maximumFractionDigits:
          typeof options['maximumFractionDigits'] === 'number'
            ? (options['maximumFractionDigits'] as number)
            : 0,
      });
      if (negative) {
        text = options['negativeParentheses'] ? `(${text})` : `-${text}`;
      }
      const unit = options['unit'];
      const suffix =
        unit === 'rial' || unit === undefined ? 'ریال' : unit === 'toman' ? 'تومان' : String(unit);
      return { text: suffix ? `${text} ${suffix}` : text };
    }

    case 'date': {
      const date = toDate(value);
      if (!date) return { text: applyDigits(String(value), locale) };
      const pattern = typeof options['pattern'] === 'string' ? options['pattern'] : 'yyyy-MM-dd';
      try {
        return { text: applyDigits(formatDate(date, pattern, locale.calendar), locale) };
      } catch (err) {
        return {
          text: applyDigits(String(value), locale),
          warning: `Invalid date pattern '${pattern}': ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    case 'custom':
    case 'text':
    default:
      return { text: applyDigits(String(value), locale) };
  }
}
