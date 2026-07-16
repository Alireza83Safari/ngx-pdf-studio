import { evaluateExpression } from './compile';
import type { ExpressionDiagnostic } from './errors';
import { type EvaluationContext } from './evaluator';
import { createDefaultFunctions } from './functions';
import { BuiltinVars, Scope } from './scope';
import type { DigitSystem } from '../model/locale';

interface EvalOpts {
  data?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  builtins?: BuiltinVars;
  digits?: DigitSystem;
  now?: () => number | null;
  maxSteps?: number;
}

function run(
  src: string,
  opts: EvalOpts = {},
): { value: unknown; diagnostics: ExpressionDiagnostic[] } {
  const diagnostics: ExpressionDiagnostic[] = [];
  const ctx: EvaluationContext = {
    functions: createDefaultFunctions(),
    digits: opts.digits ?? 'latn',
    diagnostics,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
  };
  const scope = Scope.create({
    ...(opts.data ? { data: opts.data } : {}),
    ...(opts.parameters ? { parameters: opts.parameters } : {}),
    ...(opts.builtins ? { builtins: opts.builtins } : {}),
  });
  return { value: evaluateExpression(src, scope, ctx), diagnostics };
}

describe('expression evaluator (§9)', () => {
  it('evaluates literals and arithmetic', () => {
    expect(run('1 + 2 * 3').value).toBe(7);
    expect(run('(1 + 2) * 3').value).toBe(9);
    expect(run('10 % 3').value).toBe(1);
    expect(run('-5').value).toBe(-5);
  });

  it('does string concatenation when either operand is a string', () => {
    expect(run("'a' + 'b'").value).toBe('ab');
    expect(run("'n=' + 5").value).toBe('n=5');
  });

  it('evaluates comparisons, logical short-circuit and ternary', () => {
    expect(run('2 < 3 && 3 <= 3').value).toBe(true);
    expect(run('false || 7').value).toBe(7);
    expect(run('true ? 1 : 2').value).toBe(1);
    expect(run("1 == 1 ? 'y' : 'n'").value).toBe('y');
  });

  it('null-coalesces with ??', () => {
    expect(run('a ?? 5', { data: { a: null } }).value).toBe(5);
    expect(run('a ?? 5', { data: { a: 0 } }).value).toBe(0);
  });

  it('resolves member/index access into data', () => {
    expect(run('anbar.name', { data: { anbar: { name: 'مرکزی' } } }).value).toBe('مرکزی');
    expect(run('items[1].price', { data: { items: [{ price: 10 }, { price: 20 }] } }).value).toBe(
      20,
    );
    expect(run("o['full name']", { data: { o: { 'full name': 'X' } } }).value).toBe('X');
  });

  it('applies optional-chaining semantics: missing paths resolve to null, never throw', () => {
    expect(run('a.b.c.d', { data: {} }).value).toBeNull();
    expect(run('items[99].price', { data: { items: [] } }).value).toBeNull();
  });

  it('follows the documented scope precedence: builtin → row → param → data', () => {
    const opts: EvalOpts = {
      data: { x: 'data' },
      parameters: { x: 'param' },
    };
    expect(run('x', opts).value).toBe('param'); // param shadows data
    expect(run('x', { data: { x: 'data' } }).value).toBe('data');
    expect(run('$index', { builtins: { $index: 3 } }).value).toBe(3);
  });

  it('exposes $root and $parameters for explicit outer access', () => {
    expect(run('$root.x', { data: { x: 1 } }).value).toBe(1);
    expect(run('$parameters.title', { parameters: { title: 'T' } }).value).toBe('T');
  });

  it('records a warning for unresolved references and returns null', () => {
    const { value, diagnostics } = run('nope');
    expect(value).toBeNull();
    expect(diagnostics.some((d) => /Unresolved/.test(d.message))).toBe(true);
  });
});
