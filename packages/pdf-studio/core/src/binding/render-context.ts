/**
 * The render context threads the inputs the engine needs through binding,
 * pagination, and (later) painting: the root `data`, declared `parameters`, the
 * expression `functions` table, an injected clock (`now`, for determinism — the
 * engine never calls `new Date()` itself, §3), and a `diagnostics` sink for the
 * non-fatal error policy (§9).
 */
import { createDefaultFunctions, type FunctionRegistry } from '../expression/functions';
import type { ExpressionDiagnostic } from '../expression/errors';

export interface RenderContext {
  data: Record<string, unknown>;
  parameters: Record<string, unknown>;
  functions: FunctionRegistry;
  /** Injected clock (epoch ms); `null` when unavailable. */
  now: () => number | null;
  diagnostics: ExpressionDiagnostic[];
}

export interface RenderContextInput {
  data?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  functions?: FunctionRegistry;
  /** Fixed timestamp (epoch ms) for `now()`, keeping output deterministic. */
  now?: number;
  diagnostics?: ExpressionDiagnostic[];
}

export function createRenderContext(input: RenderContextInput = {}): RenderContext {
  const fixedNow = input.now;
  return {
    data: input.data ?? {},
    parameters: input.parameters ?? {},
    functions: input.functions ?? createDefaultFunctions(),
    now: fixedNow === undefined ? () => null : () => fixedNow,
    diagnostics: input.diagnostics ?? [],
  };
}
