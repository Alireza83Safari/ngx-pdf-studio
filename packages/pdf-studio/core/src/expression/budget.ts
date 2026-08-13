/**
 * A work budget shared by every expression in one render.
 *
 * The evaluator's own `maxSteps` bounds a *single* expression and stays exactly
 * as it was — one runaway expression is still a non-fatal diagnostic, per §9.
 * This is the outer bound, and it exists because the two failure shapes are
 * different: a million cheap expressions cost as much as one expensive one, and
 * only a document-wide total notices that.
 *
 * Running out is deliberately **not** an exception here. `evaluate` promises
 * never to throw into its caller, and that promise is what lets every call site
 * treat a bad expression as a value rather than a control-flow event. So the
 * budget records that it ran out and lets evaluation unwind normally; whoever
 * set the budget decides what an exhausted one means (pagination stops at the
 * next band boundary and raises `LayoutLimitError`).
 */

export interface EvaluationBudget {
  /** Steps still available; decremented as expressions run. */
  remaining: number;
  /** Set once the budget runs out, so the owner can stop at a safe boundary. */
  exhausted: boolean;
}

export const createBudget = (maxSteps: number): EvaluationBudget => ({
  remaining: maxSteps,
  exhausted: false,
});
