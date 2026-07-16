/**
 * Framework-agnostic editor state (§8, ADR-0004). Holds an **immutable**
 * template and an explicit command history; all mutations go through
 * {@link dispatch}, never by touching the tree. Undo/redo replay captured
 * inverse/forward commands; consecutive commands sharing a `coalesceKey` merge
 * into one history step (drag/resize become a single undo).
 *
 * State changes are published via a minimal listener API (no framework
 * dependency); the Angular layer adapts `subscribe` to an RxJS `Observable`
 * (ADR-0004 amendment), so `core` stays Angular- and RxJS-free.
 */
import type { PdfTemplate } from '../model/template';
import type { Command } from './command';

interface HistoryEntry {
  /** Command that re-applies this step (forward). */
  redo: Command;
  /** Command that reverses this step (computed from the pre-apply state). */
  undo: Command;
}

export type StoreListener = (state: PdfTemplate) => void;

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

  /** Apply a command, pushing it onto the history (with coalescing). */
  dispatch(command: Command): void {
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
    } else {
      this.undoStack.push({ redo: command, undo });
    }
    this.redoStack.length = 0;
    this.setState(next);
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

  private setState(state: PdfTemplate): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
