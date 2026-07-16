/**
 * Resolves the *effective* locale and direction for an element by cascading
 * element → band → page (§4, §5, §11). `'auto'` direction is resolved from the
 * effective language as a deterministic placeholder; true per-content bidi
 * detection (UAX #9) lands with the bidi engine in Phase 3 (ADR-0003).
 */
import { getBaseDirection } from '../i18n/bidi';
import type { Direction, LocaleSetup } from '../model/locale';

/** Languages whose script is right-to-left (used to resolve `'auto'`). */
const RTL_LANGUAGES = new Set(['fa', 'ar', 'he', 'ur', 'ps', 'sd']);

/** A direction that has been fully resolved to a concrete side. */
export type ResolvedDirection = 'ltr' | 'rtl';

/** Merge a partial override onto a base locale. */
function mergeLocale(base: LocaleSetup, override?: Partial<LocaleSetup>): LocaleSetup {
  if (!override) return base;
  return {
    language: override.language ?? base.language,
    digits: override.digits ?? base.digits,
    calendar: override.calendar ?? base.calendar,
  };
}

/** Effective locale for an element: page default ← band ← element. */
export function resolveLocale(
  pageLocale: LocaleSetup,
  bandLocale?: Partial<LocaleSetup>,
  elementLocale?: Partial<LocaleSetup>,
): LocaleSetup {
  return mergeLocale(mergeLocale(pageLocale, bandLocale), elementLocale);
}

/** Base direction from a language tag (primary subtag), for `'auto'`. */
export function directionForLanguage(language: string): ResolvedDirection {
  const primary = language.toLowerCase().split('-')[0] ?? '';
  return RTL_LANGUAGES.has(primary) ? 'rtl' : 'ltr';
}

/**
 * Effective direction for an element: element ← band ← page. `'auto'` is
 * resolved by running UAX #9 base-direction detection on the element's `text`
 * when available (the correct, content-aware behavior, §11); with no text it
 * falls back to the effective language's script direction.
 */
export function resolveDirection(
  pageDirection: Direction,
  effectiveLocale: LocaleSetup,
  bandDirection?: Direction,
  elementDirection?: Direction,
  text?: string,
): ResolvedDirection {
  const chosen = elementDirection ?? bandDirection ?? pageDirection;
  if (chosen !== 'auto') return chosen;
  return text ? getBaseDirection(text) : directionForLanguage(effectiveLocale.language);
}
