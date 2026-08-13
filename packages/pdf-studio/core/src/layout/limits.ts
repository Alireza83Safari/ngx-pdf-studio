/**
 * Document-level work limits for pagination.
 *
 * The engine already bounds a *single* expression: the parser caps nesting depth
 * and the evaluator caps steps. Neither bounds a **document**, and a template is
 * paid for by the row, not by the byte. `sum(slice($root.items, 0, $index + 1),
 * …)` is the documented running-total idiom and is O(n²), so a few thousand rows
 * of JSON — small enough to slip under any request-size limit — buys minutes of
 * layout. Anyone rendering a template they did not author needs an outer bound
 * that is about total work, and that is what this is.
 *
 * The defaults are set well above any document a person would author, so a
 * legitimate report never meets them; a service rendering untrusted templates
 * should tighten them to what it is willing to spend.
 *
 * Exceeding a limit **throws**. Diagnostics are the right answer for "this
 * expression did not resolve", where a document is still produced and is still
 * correct apart from one value. A budget overrun is not that: what would come
 * back is a truncated document masquerading as a complete one, and silently
 * shipping half an invoice is worse than failing.
 */

/** Which budget ran out. */
export type LayoutLimitKind = 'pages' | 'rows' | 'expressionSteps';

export interface LayoutLimits {
  /** Pages the document may produce. */
  maxPages?: number;
  /** Rows a single dataset resolution may return. */
  maxRows?: number;
  /** Expression steps across the whole document, shared by every expression. */
  maxExpressionSteps?: number;
}

/**
 * Generous by design: these exist to stop a runaway, not to shape documents.
 * A 5000-page report is already beyond what anyone paginates in one pass, and
 * 20M expression steps is roughly a second of evaluation.
 */
export const DEFAULT_LAYOUT_LIMITS: Required<LayoutLimits> = {
  maxPages: 5_000,
  maxRows: 100_000,
  maxExpressionSteps: 20_000_000,
};

/** Thrown when a document exceeds one of its {@link LayoutLimits}. */
export class LayoutLimitError extends Error {
  /** Which budget ran out — for callers mapping this to a status code. */
  readonly limit: LayoutLimitKind;
  /** The configured ceiling that was passed. */
  readonly max: number;

  constructor(limit: LayoutLimitKind, max: number, detail: string) {
    super(`Layout exceeded the ${limit} limit (${max}): ${detail}`);
    this.name = 'LayoutLimitError';
    this.limit = limit;
    this.max = max;
  }
}

export function resolveLimits(limits: LayoutLimits | undefined): Required<LayoutLimits> {
  return { ...DEFAULT_LAYOUT_LIMITS, ...limits };
}

// The budget itself belongs to the expression engine — layout only decides how
// big it is and when to give up on it — so it is defined there and re-exported
// here, where the rest of the limit vocabulary lives.
export { createBudget, type EvaluationBudget } from '../expression/budget';
