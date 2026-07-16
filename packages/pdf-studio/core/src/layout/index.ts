/** Layout & pagination: the pure `(template, data) → Page[]` engine (§6, §7). */
export {
  SimpleTextMeasurer,
  type TextMeasurer,
  type MeasureStyle,
  type MeasuredText,
} from './measure';
export { FontkitTextMeasurer, type FontkitFontInput } from './fontkit-measurer';
export { resolvePageSize } from './page-size';
export type { LaidOutElement, LayoutPage, PaginatedDocument, VecColor, VectorOp } from './page';
export {
  ElementRegistry,
  createDefaultElements,
  type CustomElementInput,
  type CustomElementRenderer,
} from './element-registry';
export { paginate, type PaginateOptions } from './paginate';
export {
  layoutTable,
  resolveColumnWidths,
  type TableLayout,
  type TableLayoutDeps,
} from './table-layout';
