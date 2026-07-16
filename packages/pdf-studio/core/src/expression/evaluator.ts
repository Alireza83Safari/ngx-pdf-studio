/**
 * Tree-walking evaluator for the expression AST (§9). Properties:
 *
 * - **No host execution.** Calls dispatch only to the whitelisted
 *   {@link FunctionRegistry}; member/index access blocks `__proto__`,
 *   `constructor`, `prototype` and never returns functions, so a template cannot
 *   reach the `Function` constructor or any host method (§2.3).
 * - **Optional-chaining semantics.** Access on `null`/`undefined`/missing paths
 *   yields `null` and never throws (§9).
 * - **Non-fatal.** Unknown identifiers/functions and runtime errors are recorded
 *   as diagnostics; evaluation returns `null`.
 * - **Bounded.** A step counter caps total work against adversarial input.
 */
import type { Expr } from './ast';
import type { ExpressionDiagnostic } from './errors';
import type { ExpressionFunction, FnCallContext, FunctionRegistry } from './functions';
import { Scope } from './scope';
import type { DigitSystem } from '../model/locale';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DEFAULT_MAX_STEPS = 100_000;

export interface EvaluationContext {
  functions: FunctionRegistry;
  /** Effective digit system for formatting functions. */
  digits: DigitSystem;
  /** Injected clock (epoch ms) for determinism; defaults to `null`. */
  now?: () => number | null;
  /** Collected non-fatal diagnostics. */
  diagnostics: ExpressionDiagnostic[];
  /** The expression source, attached to diagnostics. */
  source?: string;
  /** Optional override for the step budget. */
  maxSteps?: number;
}

interface RunState {
  steps: number;
  aborted: boolean;
}

const truthy = (v: unknown): boolean => Boolean(v);

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return NaN;
};

/** Arg slots evaluated lazily per item by the function itself (aggregates). */
const LAZY_ARGS: Record<string, number[]> = {
  sum: [1],
  avg: [1],
  min: [1],
  max: [1],
};

/** Evaluate an AST against a scope. Never throws into the caller. */
export function evaluate(ast: Expr, scope: Scope, ctx: EvaluationContext): unknown {
  const state: RunState = { steps: 0, aborted: false };
  const max = ctx.maxSteps ?? DEFAULT_MAX_STEPS;
  const warn = (message: string): void => {
    ctx.diagnostics.push({
      severity: 'warning',
      message,
      ...(ctx.source ? { source: ctx.source } : {}),
    });
  };

  const access = (base: unknown, key: string): unknown => {
    if (base === null || base === undefined) return null;
    if (DANGEROUS_KEYS.has(key)) {
      warn(`Blocked access to unsafe property '${key}'`);
      return null;
    }
    if (typeof base === 'string') {
      if (key === 'length') return base.length;
      const idx = Number(key);
      return Number.isInteger(idx) && idx >= 0 && idx < base.length ? base[idx] : null;
    }
    if (typeof base === 'object') {
      const value = (base as Record<string, unknown>)[key];
      if (typeof value === 'function') return null;
      return value === undefined ? null : value;
    }
    return null;
  };

  const walk = (node: Expr, sc: Scope): unknown => {
    if (state.aborted) return null;
    if (++state.steps > max) {
      if (!state.aborted) {
        state.aborted = true;
        warn('Expression evaluation exceeded the step limit');
      }
      return null;
    }

    switch (node.kind) {
      case 'literal':
        return node.value;

      case 'identifier': {
        const r = sc.resolve(node.name);
        if (!r.found) {
          warn(`Unresolved reference '${node.name}'`);
          return null;
        }
        return r.value;
      }

      case 'member':
        return access(walk(node.object, sc), node.property);

      case 'index': {
        const key = walk(node.index, sc);
        return access(walk(node.object, sc), String(key));
      }

      case 'array':
        return node.elements.map((el) => walk(el, sc));

      case 'object': {
        const obj: Record<string, unknown> = {};
        for (const prop of node.properties) obj[prop.key] = walk(prop.value, sc);
        return obj;
      }

      case 'unary': {
        const v = walk(node.operand, sc);
        if (node.operator === '!') return !truthy(v);
        if (node.operator === '-') return -toNum(v);
        return toNum(v);
      }

      case 'logical': {
        const left = walk(node.left, sc);
        if (node.operator === '&&') return truthy(left) ? walk(node.right, sc) : left;
        return truthy(left) ? left : walk(node.right, sc);
      }

      case 'conditional':
        return truthy(walk(node.test, sc)) ? walk(node.consequent, sc) : walk(node.alternate, sc);

      case 'binary':
        return binary(node.operator, node, sc);

      case 'call':
        return call(node.callee, node.args, sc);
    }
  };

  const binary = (
    op: Extract<Expr, { kind: 'binary' }>['operator'],
    node: Extract<Expr, { kind: 'binary' }>,
    sc: Scope,
  ): unknown => {
    if (op === '??') {
      const left = walk(node.left, sc);
      return left === null || left === undefined ? walk(node.right, sc) : left;
    }
    const l = walk(node.left, sc);
    const r = walk(node.right, sc);
    switch (op) {
      case '+':
        return typeof l === 'string' || typeof r === 'string'
          ? `${stringify(l)}${stringify(r)}`
          : toNum(l) + toNum(r);
      case '-':
        return toNum(l) - toNum(r);
      case '*':
        return toNum(l) * toNum(r);
      case '/':
        return toNum(l) / toNum(r);
      case '%':
        return toNum(l) % toNum(r);
      case '==':
      case '===':
        return l === r;
      case '!=':
      case '!==':
        return l !== r;
      case '<':
        return compare(l, r) < 0;
      case '<=':
        return compare(l, r) <= 0;
      case '>':
        return compare(l, r) > 0;
      case '>=':
        return compare(l, r) >= 0;
      default:
        return null;
    }
  };

  const call = (callee: string, argNodes: Expr[], sc: Scope): unknown => {
    const fn: ExpressionFunction | undefined = ctx.functions.get(callee);
    if (!fn) {
      warn(`Unknown function '${callee}'`);
      return null;
    }
    // Per-item expressions of aggregates (`sum(items, qty * price)`) are only
    // meaningful inside each row's scope — evaluating them eagerly here would
    // emit spurious unresolved-reference warnings, so skip those arg slots.
    const lazySlots = LAZY_ARGS[callee];
    const args = argNodes.map((a, i) => (lazySlots && lazySlots.includes(i) ? null : walk(a, sc)));
    const fnCtx: FnCallContext = {
      args,
      rawArgs: argNodes,
      evalForItem: (n, element, index) => {
        const itemRecord =
          typeof element === 'object' && element !== null && !Array.isArray(element)
            ? (element as Record<string, unknown>)
            : {};
        return walk(n, sc.child(itemRecord, { $item: element, $index: index }));
      },
      digits: ctx.digits,
      now: ctx.now ?? (() => null),
      warn,
    };
    try {
      return fn(fnCtx);
    } catch (err) {
      warn(`Error in '${callee}': ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const result = walk(ast, scope);
  // If the budget aborted mid-tree, surface a clean null rather than a partial
  // NaN/garbage value that leaked up through arithmetic.
  return state.aborted ? null : result;
}

const stringify = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Ordering for relational operators: numeric when possible, else string. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' || typeof b === 'number') {
    const an = toNum(a);
    const bn = toNum(b);
    if (Number.isNaN(an) || Number.isNaN(bn)) return NaN;
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  const as = stringify(a);
  const bs = stringify(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}
