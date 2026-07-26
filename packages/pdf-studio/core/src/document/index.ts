/**
 * Framework-agnostic editor state: the command model + document store (§8,
 * ADR-0004). Consumed by the Angular designer, fully unit-testable without it.
 */
export { type Command, type CommandOrigin, NO_OP } from './command';
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
  moveElementZ,
  renameElement,
  setElementLocked,
  type ZOrderMove,
  addElement,
  removeElementById,
  setStaticText,
  // grouping
  groupElements,
  ungroupContainer,
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
  // style library
  addStyle,
  updateStyle,
  duplicateStyle,
  removeStyle,
} from './commands';
export { createSnippet, insertSnippet, type Snippet } from './snippet';
export {
  findElement,
  updateElement,
  insertElement,
  removeElement,
  mapElements,
  patchPage,
  elementChildren,
  boundingBox,
  resolveSiblings,
  translateElement,
  type ElementLocation,
} from './template-ops';
export { DocumentStore, type StoreListener, type HistoryStep } from './document-store';
