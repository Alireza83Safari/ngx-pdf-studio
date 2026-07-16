/**
 * The **whitelisted** function table for the expression engine (§9). Only these
 * functions are callable; untrusted templates cannot invoke anything else
 * (§2.3). The table is extensible at runtime via {@link FunctionRegistry.register}
 * (powers `PdfStudio.registerFunction`, §12).
 *
 * Calling convention: arguments are eagerly evaluated into `args`. Aggregates
 * additionally receive the raw arg ASTs and `evalForItem` so a per-item
 * expression (e.g. `sum(items, price * qty)`) evaluates against each row.
 *
 * Date/calendar formatting (Gregorian basics live here) is completed with the
 * Jalali engine in Phase 3 (ADR-0002); unimplemented calendars warn and fall
 * back rather than throwing (§9 non-fatal policy).
 */
import type { Expr } from './ast';
import { toLatinDigits, toPersianDigits } from './digits';
import { formatNumberValue, type NumberFormatSettings } from './number-format';
import type { DigitSystem } from '../model/locale';

export interface FnCallContext {
  /** Eagerly-evaluated argument values. */
  args: unknown[];
  /** Raw argument ASTs, for aggregates that evaluate an expression per item. */
  rawArgs: Expr[];
  /** Evaluate an AST against one array element pushed as the current row. */
  evalForItem: (node: Expr, element: unknown, index: number) => unknown;
  /** Effective digit system for formatting (from the element's locale). */
  digits: DigitSystem;
  /** Injected clock (epoch ms) for determinism; `null` if unavailable. */
  now: () => number | null;
  /** Record a non-fatal diagnostic. */
  warn: (message: string) => void;
}

export type ExpressionFunction = (ctx: FnCallContext) => unknown;

export class FunctionRegistry {
  private readonly fns = new Map<string, ExpressionFunction>();

  register(name: string, fn: ExpressionFunction): this {
    this.fns.set(name, fn);
    return this;
  }

  has(name: string): boolean {
    return this.fns.has(name);
  }

  get(name: string): ExpressionFunction | undefined {
    return this.fns.get(name);
  }

  /** A shallow copy, so registering on a render does not mutate the defaults. */
  clone(): FunctionRegistry {
    const copy = new FunctionRegistry();
    for (const [name, fn] of this.fns) copy.register(name, fn);
    return copy;
  }
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Resolve the numeric series an aggregate runs over (lazy per-item or eager). */
function seriesValues(ctx: FnCallContext): number[] {
  const arr = asArray(ctx.args[0]);
  const exprNode = ctx.rawArgs[1];
  if (exprNode) {
    return arr.map((el, i) => toNumber(ctx.evalForItem(exprNode, el, i)));
  }
  return arr.map(toNumber);
}

const numberSettings = (ctx: FnCallContext, opts: unknown): NumberFormatSettings => {
  const o = (typeof opts === 'object' && opts !== null ? opts : {}) as Record<string, unknown>;
  const d = o['digits'];
  const settings: NumberFormatSettings = {
    digits: d === 'persian' || d === 'latn' ? d : ctx.digits,
    useGrouping: o['useGrouping'] !== false,
  };
  const min = o['minimumFractionDigits'];
  const max = o['maximumFractionDigits'];
  if (typeof min === 'number') settings.minimumFractionDigits = min;
  if (typeof max === 'number') settings.maximumFractionDigits = max;
  return settings;
};

/** Build the default, whitelisted function table. */
export function createDefaultFunctions(): FunctionRegistry {
  const reg = new FunctionRegistry();

  // Aggregates ---------------------------------------------------------------
  reg.register('sum', (ctx) =>
    seriesValues(ctx).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
  );
  reg.register('count', (ctx) => asArray(ctx.args[0]).length);
  reg.register('avg', (ctx) => {
    const xs = seriesValues(ctx).filter(Number.isFinite);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });
  reg.register('min', (ctx) => {
    const xs = seriesValues(ctx).filter(Number.isFinite);
    return xs.length ? Math.min(...xs) : null;
  });
  reg.register('max', (ctx) => {
    const xs = seriesValues(ctx).filter(Number.isFinite);
    return xs.length ? Math.max(...xs) : null;
  });
  reg.register('first', (ctx) => asArray(ctx.args[0])[0] ?? null);
  reg.register('last', (ctx) => {
    const arr = asArray(ctx.args[0]);
    return arr.length ? (arr[arr.length - 1] ?? null) : null;
  });

  // Array / running totals ---------------------------------------------------
  // e.g. a running total in a detail row: sum(slice($root.items, 0, $index + 1), value)
  reg.register('slice', (ctx) => {
    const arr = asArray(ctx.args[0]);
    const start = toNumber(ctx.args[1]);
    const end = ctx.args[2] === undefined ? undefined : toNumber(ctx.args[2]);
    return arr.slice(
      Number.isFinite(start) ? start : 0,
      end !== undefined && Number.isFinite(end) ? end : undefined,
    );
  });
  reg.register('len', (ctx) => {
    const v = ctx.args[0];
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'string') return v.length;
    return 0;
  });

  // Math ---------------------------------------------------------------------
  reg.register('abs', (ctx) => Math.abs(toNumber(ctx.args[0])));
  reg.register('round', (ctx) => {
    const n = toNumber(ctx.args[0]);
    const digits = ctx.args[1] === undefined ? 0 : toNumber(ctx.args[1]);
    const factor = 10 ** (Number.isFinite(digits) ? digits : 0);
    return Math.round(n * factor) / factor;
  });

  // String -------------------------------------------------------------------
  reg.register('concat', (ctx) => ctx.args.map((a) => (a == null ? '' : String(a))).join(''));
  reg.register('upper', (ctx) => String(ctx.args[0] ?? '').toUpperCase());
  reg.register('lower', (ctx) => String(ctx.args[0] ?? '').toLowerCase());

  // Logic --------------------------------------------------------------------
  reg.register('if', (ctx) => (ctx.args[0] ? ctx.args[1] : (ctx.args[2] ?? null)));

  // Time ---------------------------------------------------------------------
  reg.register('now', (ctx) => ctx.now());

  // Numerals & numbers -------------------------------------------------------
  reg.register('toPersianDigits', (ctx) => toPersianDigits(String(ctx.args[0] ?? '')));
  reg.register('toLatinDigits', (ctx) => toLatinDigits(String(ctx.args[0] ?? '')));
  reg.register('formatNumber', (ctx) => {
    const n = toNumber(ctx.args[0]);
    if (!Number.isFinite(n)) return '';
    return formatNumberValue(n, numberSettings(ctx, ctx.args[1]));
  });
  reg.register('formatCurrency', (ctx) => {
    const n = toNumber(ctx.args[0]);
    if (!Number.isFinite(n)) return '';
    const o = (
      typeof ctx.args[1] === 'object' && ctx.args[1] !== null ? ctx.args[1] : {}
    ) as Record<string, unknown>;
    const symbol = typeof o['currency'] === 'string' ? o['currency'] : '';
    const body = formatNumberValue(n, numberSettings(ctx, ctx.args[1]));
    return symbol ? `${body} ${symbol}` : body;
  });

  return reg;
}
