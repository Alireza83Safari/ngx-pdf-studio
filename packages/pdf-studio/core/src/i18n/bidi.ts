/**
 * Bidirectional text support (UAX #9) via `bidi-js` (ADR-0003). One engine,
 * shared by layout and both painters, so mixed Persian/English/numbers resolve
 * **identically** in preview and PDF (§7, §11). Pure JS — browser/Node parity.
 *
 * `getBaseDirection` powers content-based `'auto'` direction resolution;
 * `reorderToVisual` converts a logical-order string to visual order for drawing.
 */
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

export type BaseDirection = 'ltr' | 'rtl';

/**
 * Resolve the base direction of `text` per UAX #9 (first strong character),
 * optionally constrained by an explicit base. Empty/neutral text → `'ltr'`.
 */
export function getBaseDirection(text: string, explicit?: 'ltr' | 'rtl'): BaseDirection {
  const { paragraphs } = bidi.getEmbeddingLevels(text, explicit ?? 'auto');
  const level = paragraphs[0]?.level ?? 0;
  return level % 2 === 1 ? 'rtl' : 'ltr';
}

/**
 * Reorder a logical-order string to visual order for a given base direction
 * (defaults to content-detected). The result is what a left-to-right glyph
 * drawer should emit.
 */
export function reorderToVisual(text: string, base?: BaseDirection): string {
  const levels = bidi.getEmbeddingLevels(text, base ?? 'auto');
  return bidi.getReorderedString(text, levels);
}

/** A directional run of text, in left-to-right visual order. */
export interface VisualRun {
  /** The run's characters in **logical** order (correct for font shaping). */
  text: string;
  rtl: boolean;
}

/**
 * Split `text` into directional runs ordered left-to-right as they should be
 * **drawn** (§7, §11). Each run carries its logical-order substring, so a glyph
 * shaper (fontkit) joins/orders it correctly, while runs themselves are placed
 * in visual order. This is how mixed Persian/English/numbers render correctly in
 * the PDF, where the painter draws each run at an advancing x position.
 */
export function getVisualRuns(text: string): VisualRun[] {
  if (!text) return [];
  const embedding = bidi.getEmbeddingLevels(text, 'auto');
  const levels = embedding.levels;
  const visualToLogical = bidi.getReorderedIndices(text, embedding);

  const runs: VisualRun[] = [];
  let i = 0;
  while (i < visualToLogical.length) {
    const startLogical = visualToLogical[i] ?? 0;
    const level = levels[startLogical] ?? 0;
    const logicalIndices: number[] = [];
    while (i < visualToLogical.length) {
      const logical = visualToLogical[i] ?? 0;
      if ((levels[logical] ?? 0) !== level) break;
      logicalIndices.push(logical);
      i++;
    }
    logicalIndices.sort((a, b) => a - b);
    const runText = logicalIndices.map((idx) => text[idx] ?? '').join('');
    runs.push({ text: runText, rtl: level % 2 === 1 });
  }
  return runs;
}
