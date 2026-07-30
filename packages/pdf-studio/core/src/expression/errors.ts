/**
 * Error & diagnostic types for the expression engine. Parse errors are thrown by
 * the low-level `parseExpression`/`tokenize` (used by tooling and tests).
 * Evaluation is **non-fatal**: it never throws into the consumer's app — errors
 * are collected as {@link ExpressionDiagnostic} and the expression yields a
 * placeholder/`null` (§9 error policy).
 */
export class ExpressionParseError extends Error {
  constructor(
    message: string,
    /** 0-based source offset where parsing failed. */
    public readonly position: number,
  ) {
    super(message);
    this.name = 'ExpressionParseError';
  }
}

export type DiagnosticSeverity = 'error' | 'warning';

export interface ExpressionDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** The expression source that produced the diagnostic, when known. */
  source?: string;
  /**
   * The element the diagnostic came from, when known — so a tool can point at
   * it rather than guessing from the message. Optional: diagnostics raised
   * outside any element (page setup, a dataset declaration) have none.
   */
  elementId?: string;
}
