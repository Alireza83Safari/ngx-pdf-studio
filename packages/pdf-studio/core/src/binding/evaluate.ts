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
): unknown {
  const evalCtx: EvaluationContext = {
    functions: ctx.functions,
    digits,
    diagnostics: ctx.diagnostics,
    now: ctx.now,
  };
  return evaluateExpression(source, scope, evalCtx);
}
