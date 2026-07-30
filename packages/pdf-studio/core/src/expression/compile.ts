/**
 * Compilation + caching layer (§9). Parsing is cached per source string so a
 * field bound to `items[0].price * qty` parses once and re-evaluates cheaply
 * across thousands of rows. Parse errors are captured (not thrown) so the
 * engine stays non-fatal end-to-end.
 */
import type { Expr } from './ast';
import { ExpressionParseError } from './errors';
import { evaluate, type EvaluationContext } from './evaluator';
import { parseExpression } from './parser';
import type { Scope } from './scope';

export interface CompiledExpression {
  source: string;
  ast: Expr | null;
  error: ExpressionParseError | null;
}

const cache = new Map<string, CompiledExpression>();

/** Compile (and cache) an expression source into a {@link CompiledExpression}. */
export function compileExpression(source: string): CompiledExpression {
  const cached = cache.get(source);
  if (cached) return cached;

  let compiled: CompiledExpression;
  try {
    compiled = { source, ast: parseExpression(source), error: null };
  } catch (err) {
    const error =
      err instanceof ExpressionParseError ? err : new ExpressionParseError(String(err), 0);
    compiled = { source, ast: null, error };
  }
  cache.set(source, compiled);
  return compiled;
}

/** Clear the compilation cache (primarily for tests/benchmarks). */
export function clearExpressionCache(): void {
  cache.clear();
}

/** Evaluate a pre-compiled expression; records a diagnostic on parse failure. */
export function evaluateCompiled(
  compiled: CompiledExpression,
  scope: Scope,
  ctx: EvaluationContext,
): unknown {
  if (!compiled.ast) {
    ctx.diagnostics.push({
      severity: 'error',
      message: `Parse error: ${compiled.error?.message ?? 'invalid expression'}`,
      source: compiled.source,
      ...(ctx.elementId ? { elementId: ctx.elementId } : {}),
    });
    return null;
  }
  return evaluate(compiled.ast, scope, { ...ctx, source: ctx.source ?? compiled.source });
}

/** Convenience: compile (cached) then evaluate a source string. */
export function evaluateExpression(source: string, scope: Scope, ctx: EvaluationContext): unknown {
  return evaluateCompiled(compileExpression(source), scope, ctx);
}
