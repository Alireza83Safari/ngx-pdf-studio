/**
 * Calendar-aware date formatting (§11, ADR-0002). Gregorian uses `date-fns`;
 * Jalali (Shamsi) uses `date-fns-jalali` — one shared token vocabulary across
 * both calendars.
 *
 * Determinism (§3): `date-fns` formats a Date's **local** components, which would
 * make output timezone-dependent. To keep browser/Node output byte-identical we
 * format the value's **UTC** components by re-projecting them onto a local-time
 * Date before formatting. No conversion ever crosses a timezone boundary, so the
 * rendered digits are independent of the host timezone (see ADR-0002 amendment).
 */
import { format as formatGregorian } from 'date-fns';
import { format as formatJalali } from 'date-fns-jalali';
import type { Calendar } from '../model/locale';

/** Re-project a Date's UTC components onto a local-time Date (see file header). */
function utcComponentsAsLocal(date: Date): Date {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
}

/**
 * Format `date` with a `date-fns` token `pattern` in the given `calendar`.
 * Deterministic and timezone-independent. May throw on an invalid pattern;
 * callers treat that as non-fatal (§9).
 */
export function formatDate(date: Date, pattern: string, calendar: Calendar): string {
  const local = utcComponentsAsLocal(date);
  return calendar === 'jalali' ? formatJalali(local, pattern) : formatGregorian(local, pattern);
}
