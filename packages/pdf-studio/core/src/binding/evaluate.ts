/**
 * Thin bridge from a {@link RenderContext} to the expression engine: builds an
 * {@link EvaluationContext} (functions, digits, clock, diagnostics sink) and
 * evaluates a source string against a {@link Scope}.
 */
import { evaluateExpression } from '../expression/compile';
import type { EvaluationContext } from '../expression/evaluator';
import type { Scope } from '../expression/scope';
import type { DigitSystem } from '../model/locale';
import type { RenderContext } from './render-context';

export function evaluateExpr(
  source: string,
  scope: Scope,
  ctx: RenderContext,
  digits: DigitSystem,
  /**
   * The element this expression belongs to. Optional, and only omitted where
   * there genuinely is no element (page setup, a dataset declaration) — every
   * diagnostic that *can* name its element should, so tooling can point at it
   * instead of parsing the message.
   */
  elementId?: string,
): unknown {
  const evalCtx: EvaluationContext = {
    functions: ctx.functions,
    digits,
    diagnostics: ctx.diagnostics,
    now: ctx.now,
    // Present only when pagination set one; a bare `createRenderContext` is
    // unbudgeted, so evaluating an expression on its own behaves as before.
    ...(ctx.budget ? { budget: ctx.budget } : {}),
    ...(elementId ? { elementId } : {}),
  };
  return evaluateExpression(source, scope, evalCtx);
}
