import { evaluateExpression } from './compile';
import type { ExpressionDiagnostic } from './errors';
import { type EvaluationContext } from './evaluator';
import { createDefaultFunctions, FunctionRegistry } from './functions';
import { toLatinDigits } from './digits';
import { Scope } from './scope';
import type { DigitSystem } from '../model/locale';

function make(opts: { digits?: DigitSystem; functions?: FunctionRegistry } = {}): {
  ctx: EvaluationContext;
  diagnostics: ExpressionDiagnostic[];
} {
  const diagnostics: ExpressionDiagnostic[] = [];
  return {
    diagnostics,
    ctx: {
      functions: opts.functions ?? createDefaultFunctions(),
      digits: opts.digits ?? 'latn',
      diagnostics,
    },
  };
}

const evalIn = (src: string, data?: Record<string, unknown>): unknown => {
  const { ctx } = make();
  return evaluateExpression(src, Scope.create(data ? { data } : {}), ctx);
};

describe('evaluator operator coverage', () => {
  it('covers every binary operator', () => {
    expect(evalIn('5 - 2')).toBe(3);
    expect(evalIn('6 / 2')).toBe(3);
    expect(evalIn('1 != 2')).toBe(true);
    expect(evalIn('2 !== 3')).toBe(true);
    expect(evalIn('3 >= 3')).toBe(true);
    expect(evalIn('4 > 2')).toBe(true);
    expect(evalIn('2 <= 2')).toBe(true);
  });

  it('covers unary plus and boolean coercion', () => {
    expect(evalIn("+'3'")).toBe(3);
    expect(evalIn('!0')).toBe(true);
  });

  it('compares strings lexicographically when no operand is numeric', () => {
    expect(evalIn("'a' < 'b'")).toBe(true);
    expect(evalIn("'b' > 'a'")).toBe(true);
  });

  it('returns null for property access on a non-object base', () => {
    expect(evalIn('n.x', { n: 5 })).toBeNull();
  });

  it('catches errors thrown inside a function as non-fatal', () => {
    const functions = createDefaultFunctions();
    functions.register('boom', () => {
      throw new Error('kaboom');
    });
    const { ctx, diagnostics } = make({ functions });
    const value = evaluateExpression('boom()', Scope.create({}), ctx);
    expect(value).toBeNull();
    expect(diagnostics.some((d) => /Error in 'boom'/.test(d.message))).toBe(true);
  });
});

describe('function edge cases', () => {
  it('coerces string-number arguments', () => {
    expect(evalIn("formatNumber('1234.5')")).toBe('1,234.5');
  });

  it('treats non-array aggregate inputs as empty', () => {
    expect(evalIn('sum(5)')).toBe(0);
    expect(evalIn('count(5)')).toBe(0);
  });

  it('formats negative numbers and rounds to zero cleanly', () => {
    expect(evalIn('formatNumber(-1234.5)')).toBe('-1,234.5');
    // Rounds to 0 within tolerance → no spurious leading minus.
    const { ctx } = make();
    expect(
      evaluateExpression(
        'formatNumber(-0.0001, { maximumFractionDigits: 2 })',
        Scope.create({}),
        ctx,
      ),
    ).toBe('0');
  });

  it('clone() isolates registrations from the original registry', () => {
    const base = createDefaultFunctions();
    const clone = base.clone();
    clone.register('extra', () => 1);
    expect(clone.has('extra')).toBe(true);
    expect(base.has('extra')).toBe(false);
  });
});

describe('digit conversion edge cases', () => {
  it('maps Arabic-Indic digits (U+0660) to Latin', () => {
    expect(toLatinDigits('٠١٩')).toBe('019');
  });
});

describe('literals and number-format options', () => {
  it('evaluates array and primitive literals', () => {
    expect(evalIn('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(evalIn('true')).toBe(true);
    expect(evalIn('false')).toBe(false);
    expect(evalIn('null')).toBeNull();
  });

  it('decodes string escapes', () => {
    expect(evalIn("'a\\tb\\nc'")).toBe('a\tb\nc');
  });

  it('honors per-call digit and grouping options', () => {
    const { ctx } = make();
    const f = (src: string): unknown => evaluateExpression(src, Scope.create({}), ctx);
    expect(f('formatNumber(12, { digits: "persian" })')).toBe('۱۲');
    expect(f('formatNumber(1234.5, { useGrouping: false })')).toBe('1234.5');
    expect(f('formatNumber(1.5, { maximumFractionDigits: 4 })')).toBe('1.5');
  });
});
