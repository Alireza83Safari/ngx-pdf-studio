/**
 * Report variables (§11A-D): named accumulators evaluated per detail row that
 * reset at a defined boundary. Their running value is exposed to expressions as
 * `$vars.<name>` — e.g. a per-row running total, or a group subtotal shown in a
 * group footer. Like JasperReports variables / RDLC running aggregates.
 */
import type { Expression } from './expression';

export type VariableCalculation = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'first' | 'last';

/** When the accumulator resets back to its empty state. */
export type VariableReset = 'report' | 'group' | 'page';

export interface VariableDef {
  /** Identifier exposed as `$vars.<name>`. */
  name: string;
  /** Per-row value combined by {@link VariableDef.calculation}. */
  expression: Expression;
  calculation: VariableCalculation;
  /** Reset boundary; defaults to `report` (never resets within the document). */
  reset?: VariableReset;
  /**
   * Group level whose key change resets a `group`-scoped variable (0 = the
   * outermost group). Ignored for other reset modes.
   */
  resetGroupLevel?: number;
}
