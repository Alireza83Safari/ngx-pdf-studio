/**
 * Text measurement abstraction (§3, §7). Layout must measure text with the
 * **same** metrics that the PDF painter uses, or preview and PDF diverge — so
 * measurement is an injected dependency, not a hard-coded browser call. The real
 * implementation (font-metric based, via fontkit) is shared by both painters and
 * lands in Phase 3; {@link SimpleTextMeasurer} is a deterministic estimator used
 * for layout development and snapshot tests until then.
 */
export interface MeasureStyle {
  fontSize: number;
  /** Line-height multiplier of font size. */
  lineHeight?: number;
  fontFamily?: string;
  /**
   * Extra advance after every glyph, in points. Both painters add it after each
   * character including the last (PDF's `Tc`, CSS `letter-spacing`), so
   * measurement counts it the same way or wrapping would disagree with paint.
   */
  letterSpacing?: number;
}

/** Advance added by letter spacing across a string, matching what is painted. */
export function spacingWidth(text: string, letterSpacing: number | undefined): number {
  if (!letterSpacing || !text) return 0;
  return [...text].length * letterSpacing;
}

export interface MeasuredText {
  /** Text broken into visual lines (honoring `\n` and width-based wrapping). */
  lines: string[];
  width: number;
  height: number;
}

export interface TextMeasurer {
  measure(text: string, style: MeasureStyle, maxWidth?: number): MeasuredText;
}

/**
 * A deterministic, font-independent estimator: every glyph is `0.5 × fontSize`
 * wide and a line is `lineHeight × fontSize` tall. Good enough to exercise the
 * pagination engine reproducibly; not metric-accurate (that is Phase 3).
 */
export class SimpleTextMeasurer implements TextMeasurer {
  private readonly charWidthFactor: number;

  constructor(charWidthFactor = 0.5) {
    this.charWidthFactor = charWidthFactor;
  }

  measure(text: string, style: MeasureStyle, maxWidth?: number): MeasuredText {
    // letter spacing folds straight into the per-character advance here, since
    // the estimator's whole model is "every glyph is the same width"
    const charWidth = style.fontSize * this.charWidthFactor + (style.letterSpacing ?? 0);
    const lineHeight = style.fontSize * (style.lineHeight ?? 1.2);
    const hardLines = text.split('\n');

    const lines: string[] = [];
    for (const hard of hardLines) {
      if (maxWidth === undefined || hard.length * charWidth <= maxWidth) {
        lines.push(hard);
      } else {
        lines.push(...this.wrapLine(hard, maxWidth, charWidth));
      }
    }

    const width = lines.reduce((max, l) => Math.max(max, l.length * charWidth), 0);
    return { lines, width, height: lines.length * lineHeight };
  }

  private wrapLine(line: string, maxWidth: number, charWidth: number): string[] {
    const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));
    const words = line.split(' ');
    const out: string[] = [];
    let current = '';

    const pushHardBreaks = (token: string): void => {
      let rest = token;
      while (rest.length > maxChars) {
        out.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      current = rest;
    };

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else if (word.length > maxChars) {
        if (current) out.push(current);
        pushHardBreaks(word);
      } else {
        if (current) out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
    return out.length ? out : [''];
  }
}
