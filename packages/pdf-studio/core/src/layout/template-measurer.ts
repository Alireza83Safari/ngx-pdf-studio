/**
 * The measurer layout uses when the document carries real font bytes (§7).
 *
 * Layout used to measure with {@link SimpleTextMeasurer} — every glyph half an
 * em — while the PDF painter drew with the actual face. Line breaks were
 * therefore computed from a shape the paper never had: text that "fit" in the
 * engine could overflow in print, and an `auto` band height was an estimate of
 * an estimate.
 *
 * This routes each measurement to whichever measurer can answer it honestly:
 * real metrics for a family we hold bytes for, the estimator for one we do not.
 * {@link FontkitTextMeasurer} on its own falls back to its *first* font for an
 * unknown family, which would measure Helvetica with Persian metrics and call
 * it accurate — the same class of silent substitution this engine reports
 * elsewhere.
 */
import { FontkitTextMeasurer, type FontkitFontInput } from './fontkit-measurer';
import {
  SimpleTextMeasurer,
  type MeasureStyle,
  type MeasuredText,
  type TextMeasurer,
} from './measure';

export class TemplateTextMeasurer implements TextMeasurer {
  private readonly real: FontkitTextMeasurer;
  private readonly families: Set<string>;
  private readonly estimate: TextMeasurer;

  constructor(fonts: FontkitFontInput[], estimate: TextMeasurer = new SimpleTextMeasurer()) {
    this.real = new FontkitTextMeasurer(fonts);
    this.families = new Set(fonts.map((f) => f.family.toLowerCase()));
    this.estimate = estimate;
  }

  measure(text: string, style: MeasureStyle, maxWidth?: number): MeasuredText {
    const family = style.fontFamily?.toLowerCase();
    // No family named (chart labels, for instance) means the painter will reach
    // for any embedded face, so measuring with one keeps the two in step.
    const useReal = family === undefined ? true : this.families.has(family);
    return (useReal ? this.real : this.estimate).measure(text, style, maxWidth);
  }
}

/**
 * Font bytes as fontkit wants them. A template carries base64 (so it stays a
 * JSON document); a caller usually has the raw bytes. `atob` is a global in
 * both the browser and Node 18+, which is this package's floor, so no
 * environment branch is needed.
 */
export function decodeFontBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof data !== 'string') return data instanceof Uint8Array ? data : new Uint8Array(data);
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Build a measurer for a set of fonts, or `undefined` when there are none —
 * in which case callers keep the estimator, which is the only honest answer
 * with no metrics to read.
 */
export function createTemplateMeasurer(
  fonts: { family: string; bytes: string | Uint8Array | ArrayBuffer }[],
): TextMeasurer | undefined {
  if (fonts.length === 0) return undefined;
  // Parsing a TTF is not cheap and an interactive canvas re-lays out on every
  // pointer move, so reuse the last measurer when it was built from the very
  // same faces. The key holds the byte references themselves, so a different
  // font can never return a stale measurer.
  const key = fonts.flatMap((f) => [f.family, f.bytes]);
  if (cache && sameKey(cache.key, key)) return cache.measurer;
  let measurer: TextMeasurer | undefined;
  try {
    measurer = new TemplateTextMeasurer(
      fonts.map((f) => ({ family: f.family, bytes: decodeFontBytes(f.bytes) })),
    );
  } catch {
    // unparseable or unsupported bytes: estimating beats failing the render,
    // and the painter reports the same font separately
    measurer = undefined;
  }
  cache = { key, measurer };
  return measurer;
}

let cache: { key: unknown[]; measurer: TextMeasurer | undefined } | null = null;

function sameKey(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Drop the memoised measurer. Exposed for tests and long-lived processes. */
export function clearMeasurerCache(): void {
  cache = null;
}
