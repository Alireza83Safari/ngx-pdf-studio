/**
 * Persian number-to-words (§11, ROADMAP ۱.۱): converts numbers to formal
 * Persian prose — «۴٬۸۵۰٬۰۰۰» → «چهار میلیون و هشتصد و پنجاه هزار» — as
 * required on official invoices («مبلغ به حروف»). Supports negatives,
 * decimals (read as ممیز + fractional unit, e.g. «دوازده ممیز سی و پنج
 * صدم»), and magnitudes up to «هزار میلیارد» (10^12 groups).
 *
 * Deterministic and locale-pure: no Intl, no host formatting.
 */

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = [
  'ده',
  'یازده',
  'دوازده',
  'سیزده',
  'چهارده',
  'پانزده',
  'شانزده',
  'هفده',
  'هجده',
  'نوزده',
];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
/** Scale of each 3-digit group, least-significant first. */
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'هزار میلیارد'];
/** Fractional unit by number of decimal digits. */
const FRACTION_UNITS = ['', 'دهم', 'صدم', 'هزارم', 'ده‌هزارم', 'صدهزارم', 'میلیونیم'];

const JOIN = ' و ';

/** 0–999 to words ('' for 0 — callers handle zero explicitly). */
function threeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h] as string);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10] as string);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t > 0) parts.push(TENS[t] as string);
    if (o > 0) parts.push(ONES[o] as string);
  }
  return parts.join(JOIN);
}

/** Non-negative integer to words; returns 'صفر' for 0. */
function integerToWords(n: number): string {
  if (n === 0) return 'صفر';
  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] as number;
    if (g === 0) continue;
    const scale = SCALES[i] ?? '';
    // «یک هزار» is idiomatic as «یک هزار»؟ نه — فارسی رسمی «یک هزار» را
    // «هزار» می‌گوید فقط وقتی تنها است؛ در مبالغ رسمی «یک هزار» هم رایج است.
    // ساده و بی‌ابهام: همیشه عدد گروه را کامل بخوان.
    parts.push(scale ? `${threeDigits(g)} ${scale}` : threeDigits(g));
  }
  return parts.join(JOIN);
}

export interface NumberToWordsOptions {
  /**
   * Currency suffix: `'rial'` → «ریال», `'toman'` → «تومان», any other
   * string is appended verbatim (e.g. `'دلار'`).
   */
  currency?: string;
}

/**
 * Convert a number to formal Persian words. Non-finite input returns ''.
 * Decimals are read with «ممیز» and the fractional unit (up to 6 digits;
 * more are rounded).
 */
export function numberToPersianWords(value: number, options: NumberToWordsOptions = {}): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const negative = value < 0;
  const abs = Math.abs(value);
  const intPart = Math.floor(abs);

  // fraction via fixed-point string to dodge float noise (0.35 → '35')
  let fracDigits = abs.toFixed(6).split('.')[1] as string;
  fracDigits = fracDigits.replace(/0+$/, '');

  let words: string;
  if (fracDigits.length > 0) {
    const fracValue = parseInt(fracDigits, 10);
    const unit = FRACTION_UNITS[fracDigits.length] as string;
    words = `${integerToWords(intPart)} ممیز ${integerToWords(fracValue)} ${unit}`;
  } else {
    words = integerToWords(intPart);
  }

  if (negative) words = `منفی ${words}`;

  const currency = options.currency;
  if (currency) {
    const suffix = currency === 'rial' ? 'ریال' : currency === 'toman' ? 'تومان' : currency;
    words = `${words} ${suffix}`;
  }
  return words;
}
