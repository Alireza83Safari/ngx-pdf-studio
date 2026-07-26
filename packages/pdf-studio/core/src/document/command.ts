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
  /**
   * Human-readable step label for a visible history list. Falls back to `type`
   * when absent, so no command has to provide one.
   */
  readonly label?: string;
}

/**
 * Who and when a dispatch came from. Optional throughout: single-user editing
 * needs none of it, while multi-user editing (ROADMAP 5.2, Yjs over the command
 * stream) needs to tell local edits from remote ones.
 *
 * Timestamps are supplied by the caller, never read from the clock here — `core`
 * must stay deterministic (no `new Date()`; see the architecture invariants).
 */
export interface CommandOrigin {
  /** Identifies the editor that produced the command. */
  actor?: string;
  /** Epoch milliseconds, injected by the host. */
  at?: number;
}

/** A command that does nothing — used as a safe inverse when a target is gone. */
export const NO_OP: Command = {
  type: 'noop',
  apply: (state) => state,
  invert: () => NO_OP,
};
