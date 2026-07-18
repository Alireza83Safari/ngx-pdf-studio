/**
 * Framework-agnostic editor state: the command model + document store (§8,
 * ADR-0004). Consumed by the Angular designer, fully unit-testable without it.
 */
export { type Command, NO_OP } from './command';
export {
  composite,
  patchElement,
  setElementBounds,
  setElementZIndex,
  addElement,
  removeElementById,
  patchPageSetup,
  setStaticText,
} from './commands';
export {
  findElement,
  updateElement,
  insertElement,
  removeElement,
  patchPage,
  type ElementLocation,
} from './template-ops';
export { DocumentStore, type StoreListener } from './document-store';
