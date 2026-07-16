/** Public surface of the sandboxed expression engine (§9). */
export type { Expr } from './ast';
export { ExpressionParseError } from './errors';
export type { ExpressionDiagnostic, DiagnosticSeverity } from './errors';
export { tokenize } from './lexer';
export { parseExpression } from './parser';
export { Scope, type BuiltinVars } from './scope';
export {
  FunctionRegistry,
  createDefaultFunctions,
  type ExpressionFunction,
  type FnCallContext,
} from './functions';
export { toPersianDigits, toLatinDigits } from './digits';
export { formatNumberValue, type NumberFormatSettings } from './number-format';
export { evaluate, type EvaluationContext } from './evaluator';
export {
  compileExpression,
  evaluateCompiled,
  evaluateExpression,
  clearExpressionCache,
  type CompiledExpression,
} from './compile';
