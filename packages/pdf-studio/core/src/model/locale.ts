/**
 * Direction & locale model. Neither Persian nor English is the "default";
 * both are equal citizens and may be mixed within one document or one line
 * (§2.4, §11). Direction and locale resolve element → band → page, with
 * `'auto'` running bidi detection on the content.
 */

/** Resolved text direction. `'auto'` defers to content-based bidi detection. */
export type Direction = 'ltr' | 'rtl' | 'auto';

/**
 * BCP-47-ish language tag. `'fa'` and `'en'` are first-class; the type stays
 * open so consumers can register more locales (§9 extensibility). The
 * `string & {}` keeps editor autocomplete for the known literals while still
 * accepting any string — an intentional, well-known TS idiom.
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- open-union autocomplete idiom (see doc above)
export type Language = 'fa' | 'en' | (string & {});

/** Numeral system used to render digits. */
export type DigitSystem = 'latn' | 'persian';

/** Calendar system used to render/parse dates. */
export type Calendar = 'gregorian' | 'jalali';

/**
 * Document-default locale. Every field is independently overridable per band
 * and per element via `Partial<LocaleSetup>` (§4, §5).
 */
export interface LocaleSetup {
  /** Controls default direction & formatting locale; extensible. */
  language: Language;
  /** Default numeral system for fields. */
  digits: DigitSystem;
  /** Default calendar for date fields. */
  calendar: Calendar;
}
