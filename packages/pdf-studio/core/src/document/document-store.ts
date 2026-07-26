/**
 * Framework-agnostic editor state (§8, ADR-0004). Holds an **immutable**
 * template and an explicit command history; all mutations go through
 * {@link DocumentStore.dispatch}, never by touching the tree. Undo/redo replay
 * captured inverse/forward commands; consecutive commands sharing a
 * `coalesceKey` merge into one history step (drag/resize become a single undo).
 *
 * State changes are published via a minimal listener API (no framework
 * dependency); the Angular layer adapts `subscribe` to an RxJS `Observable`
 * (ADR-0004 amendment), so `core` stays Angular- and RxJS-free.
 */
import type { PdfTemplate } from '../model/template';
import type { Command, CommandOrigin } from './command';

interface HistoryEntry {
  /** Command that re-applies this step (forward). */
  redo: Command;
  /** Command that reverses this step (computed from the pre-apply state). */
  undo: Command;
  /** Who dispatched it and when, when the host supplied that. */
  origin?: CommandOrigin;
}

export type StoreListener = (state: PdfTemplate) => void;

/** One entry of the visible undo history, newest last. */
export interface HistoryStep {
  /** `command.label` when given, else the command `type`. */
  label: string;
  /** Command kind, for icons or filtering. */
  type: string;
  actor?: string;
  at?: number;
}

export class DocumentStore {
  private state: PdfTemplate;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<StoreListener>();

  constructor(initial: PdfTemplate) {
    this.state = initial;
  }

  /** Current template (immutable; replace via {@link dispatch}). */
  getState(): PdfTemplate {
    return this.state;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Subscribe to state changes. Returns an unsubscribe function. The listener is
   * invoked immediately with the current state, then on every change.
   */
  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Apply a command, pushing it onto the history (with coalescing). `origin`
   * is recorded for {@link getHistory} and multi-user attribution; it never
   * affects how the command applies.
   */
  dispatch(command: Command, origin?: CommandOrigin): void {
    const undo = command.invert(this.state);
    const next = command.apply(this.state);

    const last = this.undoStack[this.undoStack.length - 1];
    const coalesce =
      command.coalesceKey !== undefined &&
      last !== undefined &&
      last.redo.coalesceKey === command.coalesceKey;

    if (coalesce && last) {
      // Keep the original `undo` (restores to before the interaction began);
      // only advance the forward command to the latest.
      last.redo = command;
      if (origin) last.origin = origin;
    } else {
      this.undoStack.push({ redo: command, undo, ...(origin ? { origin } : {}) });
    }
    this.redoStack.length = 0;
    this.setState(next);
  }

  /**
   * Apply a command that came from **elsewhere** — another collaborator, or a
   * replayed stream (ROADMAP 5.2) — updating the document without touching this
   * editor's undo history. A user must never undo a peer's edit by pressing
   * Ctrl+Z, and their own redo stack must survive a peer's arrival.
   */
  applyRemote(command: Command): void {
    this.setState(command.apply(this.state));
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(entry);
    this.setState(entry.undo.apply(this.state));
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(entry);
    this.setState(entry.redo.apply(this.state));
  }

  /**
   * The undoable steps, oldest first — for a visible history list where the user
   * can see what they did and jump back. Index `n` corresponds to
   * {@link undoTo}: the last entry is the most recent step.
   */
  getHistory(): HistoryStep[] {
    return this.undoStack.map((entry) => ({
      label: entry.redo.label ?? entry.redo.type,
      type: entry.redo.type,
      ...(entry.origin?.actor !== undefined ? { actor: entry.origin.actor } : {}),
      ...(entry.origin?.at !== undefined ? { at: entry.origin.at } : {}),
    }));
  }

  /**
   * Undo back to just **after** the step at `index` in {@link getHistory} — i.e.
   * clicking a history row restores the document as it looked then. Pass `-1`
   * to undo everything. Redo still walks forward afterwards, since the entries
   * move to the redo stack in order.
   */
  undoTo(index: number): void {
    const target = Math.max(-1, Math.min(index, this.undoStack.length - 1));
    while (this.undoStack.length > target + 1) this.undo();
  }

  private setState(state: PdfTemplate): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
