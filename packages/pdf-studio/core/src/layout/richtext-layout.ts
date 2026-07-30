/**
 * Lays out a {@link RichTextElement} (§5): resolves each run's text (literal or
 * inline expression), wraps words across runs to the element width keeping each
 * word's own style, and groups consecutive same-style words back into run
 * segments per line. The painters draw the resulting {@link LaidRichText} run by
 * run. Returns the laid rich text plus its total height (for auto-grow).
 */
import { evaluateExpr } from '../binding/evaluate';
import type { RenderContext } from '../binding/render-context';
import type { Scope } from '../expression/scope';
import type { Paragraph, RichTextElement, TextRun } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { HorizontalAlign } from '../model/style';
import type { TextMeasurer } from './measure';
import type { LaidParagraph, LaidRichText, LaidTextLine, LaidTextRun } from './page';

const DEFAULT_FONT_SIZE = 12;
const DEFAULT_LINE_HEIGHT = 1.2;

interface Deps {
  ctx: RenderContext;
  measurer: TextMeasurer;
}

interface RunStyle {
  fontFamily?: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}
interface Word {
  text: string;
  style: RunStyle;
  width: number;
  space: boolean;
}

export function resolveRichText(
  el: RichTextElement,
  scope: Scope,
  locale: LocaleSetup,
  deps: Deps,
): { richText: LaidRichText; height: number } {
  const maxWidth = el.bounds.width;
  let height = 0;
  const paragraphs = el.paragraphs.map((p) => {
    const laid = layoutParagraph(p, maxWidth, scope, locale, deps, el.id);
    height += laid.lines.reduce((sum, line) => sum + line.height, 0);
    return laid;
  });
  return { richText: { paragraphs }, height };
}

function layoutParagraph(
  p: Paragraph,
  maxWidth: number,
  scope: Scope,
  locale: LocaleSetup,
  deps: Deps,
  elementId: string,
): LaidParagraph {
  const words: Word[] = [];
  for (const run of p.runs) {
    const text = runText(run, scope, locale, deps, elementId);
    const style = runStyle(run);
    for (const token of text.split(/(\s+)/)) {
      if (token === '') continue;
      const space = /^\s+$/.test(token);
      const width = deps.measurer.measure(token, measureStyle(style)).width;
      words.push({ text: token, style, width, space });
    }
  }

  const lineMultiplier = p.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const lines: LaidTextLine[] = [];
  let current: Word[] = [];
  let currentWidth = 0;
  for (const word of words) {
    if (!word.space && current.length > 0 && currentWidth + word.width > maxWidth) {
      lines.push(toLine(current, lineMultiplier));
      current = [];
      currentWidth = 0;
    }
    current.push(word);
    currentWidth += word.width;
  }
  if (current.length > 0) lines.push(toLine(current, lineMultiplier));

  return { lines, align: (p.align ?? 'start') as HorizontalAlign };
}

/** Merge consecutive same-style words into run segments. */
function toLine(words: Word[], lineMultiplier: number): LaidTextLine {
  const runs: LaidTextRun[] = [];
  let maxFontSize = 0;
  let width = 0;
  for (const word of words) {
    width += word.width;
    maxFontSize = Math.max(maxFontSize, word.style.fontSize);
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, word.style)) {
      last.text += word.text;
      last.width += word.width;
    } else {
      runs.push({
        text: word.text,
        ...(word.style.fontFamily !== undefined ? { fontFamily: word.style.fontFamily } : {}),
        fontSize: word.style.fontSize,
        bold: word.style.bold,
        italic: word.style.italic,
        underline: word.style.underline,
        width: word.width,
      });
    }
  }
  return { runs, width, height: maxFontSize * lineMultiplier };
}

function runText(
  run: TextRun,
  scope: Scope,
  locale: LocaleSetup,
  deps: Deps,
  elementId: string,
): string {
  if (run.text !== undefined) return run.text;
  if (run.expr) {
    const value = evaluateExpr(run.expr.source, scope, deps.ctx, locale.digits, elementId);
    return value == null ? '' : String(value);
  }
  return '';
}

function runStyle(run: TextRun): RunStyle {
  return {
    ...(run.fontFamily !== undefined ? { fontFamily: run.fontFamily } : {}),
    fontSize: run.fontSize ?? DEFAULT_FONT_SIZE,
    bold: run.bold ?? false,
    italic: run.italic ?? false,
    underline: run.underline ?? false,
  };
}

function measureStyle(style: RunStyle): { fontSize: number; fontFamily?: string } {
  return {
    fontSize: style.fontSize,
    ...(style.fontFamily !== undefined ? { fontFamily: style.fontFamily } : {}),
  };
}

function sameStyle(run: LaidTextRun, style: RunStyle): boolean {
  return (
    run.fontFamily === style.fontFamily &&
    run.fontSize === style.fontSize &&
    run.bold === style.bold &&
    run.italic === style.italic &&
    run.underline === style.underline
  );
}
