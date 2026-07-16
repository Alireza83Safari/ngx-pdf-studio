import { evaluateExpression } from './compile';
import type { ExpressionDiagnostic } from './errors';
import { type EvaluationContext } from './evaluator';
import { createDefaultFunctions, FunctionRegistry } from './functions';
import { Scope } from './scope';
import type { DigitSystem } from '../model/locale';

function run(
  src: string,
  opts: {
    data?: Record<string, unknown>;
    digits?: DigitSystem;
    now?: () => number | null;
    functions?: FunctionRegistry;
  } = {},
): unknown {
  const diagnostics: ExpressionDiagnostic[] = [];
  const ctx: EvaluationContext = {
    functions: opts.functions ?? createDefaultFunctions(),
    digits: opts.digits ?? 'latn',
    diagnostics,
    ...(opts.now ? { now: opts.now } : {}),
  };
  return evaluateExpression(src, Scope.create({ ...(opts.data ? { data: opts.data } : {}) }), ctx);
}

const ITEMS = {
  items: [
    { price: 10, qty: 2 },
    { price: 5, qty: 3 },
  ],
};

describe('built-in functions (§9)', () => {
  it('aggregates with a per-item expression (lazy evaluation against each row)', () => {
    expect(run('sum(items, price * qty)', { data: ITEMS })).toBe(35);
    expect(run('avg(items, price)', { data: ITEMS })).toBe(7.5);
    expect(run('min(items, price)', { data: ITEMS })).toBe(5);
    expect(run('max(items, qty)', { data: ITEMS })).toBe(3);
  });

  it('treats missing/non-numeric fields as 0 in sums (non-fatal)', () => {
    const data = { items: [{ price: 10 }, { note: 'x' }, { price: 5 }] };
    expect(run('sum(items, price)', { data })).toBe(15);
  });

  it('aggregates over a plain numeric array', () => {
    expect(run('sum(xs)', { data: { xs: [1, 2, 3] } })).toBe(6);
    expect(run('count(xs)', { data: { xs: [1, 2, 3] } })).toBe(3);
  });

  it('first/last return null on empty arrays', () => {
    expect(run('first(xs)', { data: { xs: [] } })).toBeNull();
    expect(run('last(xs)', { data: { xs: [9, 8] } })).toBe(8);
  });

  it('string and logic helpers', () => {
    expect(run("concat('a', 1, 'b')")).toBe('a1b');
    expect(run("upper('aB')")).toBe('AB');
    expect(run("lower('aB')")).toBe('ab');
    expect(run("if(2 > 1, 'yes', 'no')")).toBe('yes');
  });

  it('now() returns the injected clock for determinism', () => {
    expect(run('now()', { now: () => 1_700_000_000_000 })).toBe(1_700_000_000_000);
    expect(run('now()')).toBeNull();
  });

  it('converts digits both ways', () => {
    expect(run("toPersianDigits('2026')")).toBe('۲۰۲۶');
    expect(run("toLatinDigits('۲۰۲۶')")).toBe('2026');
  });

  it('formats numbers per the effective digit system', () => {
    expect(run('formatNumber(1234.5)')).toBe('1,234.5');
    expect(run('formatNumber(1234.5)', { digits: 'persian' })).toBe('۱٬۲۳۴٫۵');
    expect(run('formatNumber(1, { minimumFractionDigits: 2 })')).toBe('1.00');
  });

  it('formats currency with a symbol', () => {
    expect(run("formatCurrency(1000, { currency: '﷼' })")).toBe('1,000 ﷼');
  });

  it('provides slice/len/abs/round helpers', () => {
    expect(run('slice(items, 0, 2)', { data: { items: [1, 2, 3, 4] } })).toEqual([1, 2]);
    expect(run('slice(items, 1)', { data: { items: [1, 2, 3] } })).toEqual([2, 3]);
    expect(run('len(items)', { data: { items: [1, 2, 3] } })).toBe(3);
    expect(run("len('hello')")).toBe(5);
    expect(run('abs(-7)')).toBe(7);
    expect(run('round(3.14159, 2)')).toBe(3.14);
    expect(run('round(2.6)')).toBe(3);
  });

  it('computes a running total with slice + sum (§11A-D)', () => {
    const data = {
      items: [{ v: 10 }, { v: 20 }, { v: 5 }],
    };
    // running total = sum of v for rows 0..$index
    expect(run('sum(slice($root.items, 0, 1), v)', { data })).toBe(10);
    expect(run('sum(slice($root.items, 0, 3), v)', { data })).toBe(35);
  });

  it('is extensible via the function registry (§12)', () => {
    const functions = createDefaultFunctions();
    functions.register('double', (ctx) => Number(ctx.args[0]) * 2);
    expect(run('double(21)', { functions })).toBe(42);
  });
});
