import { evaluateExpression } from './compile';
import type { ExpressionDiagnostic } from './errors';
import { type EvaluationContext } from './evaluator';
import { createDefaultFunctions } from './functions';
import { Scope } from './scope';

function run(
  src: string,
  opts: { data?: Record<string, unknown>; maxSteps?: number } = {},
): { value: unknown; diagnostics: ExpressionDiagnostic[] } {
  const diagnostics: ExpressionDiagnostic[] = [];
  const ctx: EvaluationContext = {
    functions: createDefaultFunctions(),
    digits: 'latn',
    diagnostics,
    ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
  };
  const value = evaluateExpression(
    src,
    Scope.create({ ...(opts.data ? { data: opts.data } : {}) }),
    ctx,
  );
  return { value, diagnostics };
}

describe('expression sandbox safety (§2.3, §9)', () => {
  it('blocks access to constructor / __proto__ / prototype', () => {
    expect(run('x.constructor', { data: { x: {} } }).value).toBeNull();
    expect(run('x.__proto__', { data: { x: {} } }).value).toBeNull();
    expect(run("x['prototype']", { data: { x: {} } }).value).toBeNull();
  });

  it('cannot reach the Function constructor to execute host code', () => {
    // The classic sandbox-escape chain resolves to null at the first hop.
    expect(run('x.constructor.constructor', { data: { x: {} } }).value).toBeNull();
  });

  it('never returns host methods (function-valued properties become null)', () => {
    expect(run('s.toUpperCase', { data: { s: 'abc' } }).value).toBeNull();
    // but real data properties still resolve
    expect(run('s.length', { data: { s: 'abc' } }).value).toBe(3);
  });

  it('treats unknown functions as non-fatal', () => {
    const { value, diagnostics } = run('hack(1)');
    expect(value).toBeNull();
    expect(diagnostics.some((d) => /Unknown function/.test(d.message))).toBe(true);
  });

  it('enforces a step budget against runaway expressions', () => {
    const { value, diagnostics } = run('1 + 1 + 1 + 1 + 1 + 1 + 1 + 1', { maxSteps: 4 });
    expect(value).toBeNull();
    expect(diagnostics.some((d) => /step limit/.test(d.message))).toBe(true);
  });

  it('does not execute code from string literals', () => {
    // A string that looks like code is just a string.
    expect(run("'process.exit(1)'").value).toBe('process.exit(1)');
  });
});
