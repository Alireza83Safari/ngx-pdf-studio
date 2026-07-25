/**
 * Framework-agnostic editor state: the command model + document store (§8,
 * ADR-0004). Consumed by the Angular designer, fully unit-testable without it.
 */
export { type Command, NO_OP } from './command';
export {
  composite,
  // element
  patchElement,
  replaceElement,
  modifyElement,
  setElementBounds,
  setElementsBounds,
  moveElementsBy,
  setElementZIndex,
  addElement,
  removeElementById,
  setStaticText,
  // band
  patchBand,
  addBand,
  removeBandById,
  moveBand,
  // document
  patchPageSetup,
  patchMetadata,
  renameTemplate,
  ensureStyles,
  ensureDataset,
  replaceTemplate,
} from './commands';
export {
  findElement,
  updateElement,
  insertElement,
  removeElement,
  patchPage,
  elementChildren,
  type ElementLocation,
} from './template-ops';
export { DocumentStore, type StoreListener } from './document-store';
