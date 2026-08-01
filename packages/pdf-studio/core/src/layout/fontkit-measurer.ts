/**
 * A {@link TextMeasurer} backed by real font metrics via fontkit (ADR-0003).
 * This is the measurer that closes WYSIWYG text parity (§7): layout measures
 * with the **same** font (advance widths, kerning, ascent/descent) that the PDF
 * painter embeds and draws with, so a line that fits in the engine fits in the
 * PDF. Construct it from the same font bytes passed to the PDF painter.
 *
 * The default {@link SimpleTextMeasurer} stays the zero-config fallback when no
 * font bytes are available.
 */
import * as fontkitNs from '@pdf-lib/fontkit';
import { spacingWidth, type MeasureStyle, type MeasuredText, type TextMeasurer } from './measure';

// esbuild's browser bundle nests this CJS module under `.default`; Node keeps
// it on the namespace. Use whichever object actually exposes `create`.
const fontkit =
  typeof (fontkitNs as { create?: unknown }).create === 'function'
    ? fontkitNs
    : (fontkitNs as unknown as { default: typeof fontkitNs }).default;

interface FkGlyphPosition {
  xAdvance: number;
}
interface FkGlyphRun {
  positions: FkGlyphPosition[];
}
interface FkFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  layout(text: string): FkGlyphRun;
}
// @pdf-lib/fontkit ships minimal types; bridge its `create` at this boundary.
const fk = fontkit as unknown as { create(buffer: Uint8Array): FkFont };

export interface FontkitFontInput {
  family: string;
  bytes: Uint8Array;
}

/**
 * Parsing a face is the expensive part — a real typeface is hundreds of
 * kilobytes and an interactive canvas re-lays out on every pointer move. Keyed
 * on the byte array itself, so the same bytes are parsed once however many
 * measurers are built from them, and a garbage-collected buffer takes its
 * parsed font with it.
 */
const parsed = new WeakMap<Uint8Array, FkFont>();

function parseFont(bytes: Uint8Array): FkFont {
  const hit = parsed.get(bytes);
  if (hit) return hit;
  const font = fk.create(bytes);
  parsed.set(bytes, font);
  return font;
}

export class FontkitTextMeasurer implements TextMeasurer {
  private readonly byFamily = new Map<string, FkFont>();
  private readonly fallback: FkFont;

  constructor(fonts: FontkitFontInput[]) {
    const first = fonts[0];
    if (!first) throw new Error('FontkitTextMeasurer requires at least one font');
    for (const font of fonts) {
      const key = font.family.toLowerCase();
      if (!this.byFamily.has(key)) this.byFamily.set(key, parseFont(font.bytes));
    }
    this.fallback = this.byFamily.get(first.family.toLowerCase()) as FkFont;
  }

  measure(text: string, style: MeasureStyle, maxWidth?: number): MeasuredText {
    const font =
      (style.fontFamily && this.byFamily.get(style.fontFamily.toLowerCase())) || this.fallback;
    const scale = style.fontSize / font.unitsPerEm;
    const lineHeight =
      style.lineHeight !== undefined
        ? style.fontSize * style.lineHeight
        : (font.ascent - font.descent) * scale;
    const widthOf = (s: string): number =>
      s
        ? font.layout(s).positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale +
          spacingWidth(s, style.letterSpacing)
        : 0;

    const lines: string[] = [];
    for (const hard of text.split('\n')) {
      if (maxWidth === undefined || widthOf(hard) <= maxWidth) lines.push(hard);
      else lines.push(...wrap(hard, maxWidth, widthOf));
    }

    const width = lines.reduce((max, l) => Math.max(max, widthOf(l)), 0);
    return { lines, width, height: lines.length * lineHeight };
  }
}

function wrap(line: string, maxWidth: number, widthOf: (s: string) => number): string[] {
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';

  const hardBreak = (token: string): void => {
    let rest = token;
    while (widthOf(rest) > maxWidth && rest.length > 1) {
      let i = 1;
      while (i < rest.length && widthOf(rest.slice(0, i + 1)) <= maxWidth) i++;
      out.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    current = rest;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (widthOf(candidate) <= maxWidth) {
      current = candidate;
    } else if (widthOf(word) > maxWidth) {
      if (current) out.push(current);
      hardBreak(word);
    } else {
      if (current) out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [''];
}
