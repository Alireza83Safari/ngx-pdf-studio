/**
 * The command model (§8, ADR-0004). Every designer mutation is a `Command` that
 * can `apply` to a template and `invert` (given the pre-apply state) into the
 * command that undoes it — so undo/redo is reversible by construction. Commands
 * sharing a `coalesceKey` merge into a single history step (e.g. a drag).
 */
import type { PdfTemplate } from '../model/template';

export interface Command {
  /** Stable identifier for the command kind (diagnostics/telemetry). */
  readonly type: string;
  /** Pure transform producing the next template (no in-place mutation). */
  apply(state: PdfTemplate): PdfTemplate;
  /** Given the state *before* `apply`, return the command that reverses it. */
  invert(state: PdfTemplate): Command;
  /** Consecutive commands with the same key collapse into one undo step. */
  readonly coalesceKey?: string;
}

/** A command that does nothing — used as a safe inverse when a target is gone. */
export const NO_OP: Command = {
  type: 'noop',
  apply: (state) => state,
  invert: () => NO_OP,
};
