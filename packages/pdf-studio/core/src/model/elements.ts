/**
 * The concrete element catalog (§5). Each element extends {@link ElementBase}
 * and is discriminated by `type`. New element types are added via the element
 * registry (§12) without forking; this union covers the built-ins.
 */
import type { ElementBase } from './element-base';
import type { Expression } from './expression';
import type { FormatDescriptor } from './format';
import type { BorderSide, HorizontalAlign } from './style';
import type { Pt } from './units';

/** Fixed string with full typography. */
export interface StaticTextElement extends ElementBase {
  type: 'staticText';
  text: string;
}

/** Value bound to an expression, with optional format + null fallback (§5, §9). */
export interface DataFieldElement extends ElementBase {
  type: 'dataField';
  value: Expression;
  format?: FormatDescriptor;
  /** Rendered when the bound value is null/undefined. */
  fallback?: string;
}

/** A single styled run inside a {@link RichTextElement} paragraph. */
export interface TextRun {
  /** Literal text, or an inline expression when `expr` is set. */
  text?: string;
  expr?: Expression;
  fontFamily?: string;
  fontSize?: Pt;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface Paragraph {
  runs: TextRun[];
  align?: HorizontalAlign;
  lineHeight?: number;
}

/** Multi-run rich text with inline fields, wrapping, justification, RTL (§5). */
export interface RichTextElement extends ElementBase {
  type: 'richText';
  paragraphs: Paragraph[];
}

export type ImageFit = 'contain' | 'cover' | 'fill' | 'none';

/** Static (embedded resource id) or dynamic (expression → URL/base64). */
export interface ImageElement extends ElementBase {
  type: 'image';
  /** Resource id into `resources.images`. */
  resourceId?: string;
  /** Dynamic source expression (URL or base64); used when `resourceId` unset. */
  source?: Expression;
  fit?: ImageFit;
  altText?: string;
}

export type ColumnWidth =
  | { kind: 'fixed'; value: Pt }
  | { kind: 'percent'; value: number }
  | { kind: 'auto' };

export type Aggregate = 'sum' | 'avg' | 'count' | 'min' | 'max';

export interface TableCell {
  /** Cell content expression (header cells are usually literal text). */
  content?: Expression;
  text?: string;
  styleId?: string;
  /** Footer aggregate over the column's bound values. */
  aggregate?: Aggregate;
  /** Column-span / row-span for merged cells. */
  colSpan?: number;
  rowSpan?: number;
}

export interface TableColumn {
  id: string;
  width: ColumnWidth;
  header?: TableCell;
  footer?: TableCell;
  detail?: TableCell;
  /** Optional column-group label this column belongs to. */
  group?: string;
}

/** Tabular element bound to a dataset/array (§5). */
export interface TableElement extends ElementBase {
  type: 'table';
  /** Dataset name or an array expression driving the rows. */
  dataset: string;
  columns: TableColumn[];
  /** Repeat the header row after every page break. */
  repeatHeader?: boolean;
  /** Alternating-row background style id. */
  rowStripeStyleId?: string;
  border?: BorderSide;
}

/** Free-form repeater: repeats a sub-layout per array item (§5). */
export interface ListElement extends ElementBase {
  type: 'list';
  dataset: string;
  /** Elements composing one item template (band-relative to the item box). */
  itemTemplate: AnyElement[];
  itemHeight: Pt;
  /** Gap between items. */
  gap?: Pt;
  /** Layout flow of repeated items (independent of text `direction`). */
  orientation?: 'vertical' | 'horizontal';
}

export interface LineElement extends ElementBase {
  type: 'line';
  stroke: BorderSide;
}

export interface RectangleElement extends ElementBase {
  type: 'rectangle';
}

export interface EllipseElement extends ElementBase {
  type: 'ellipse';
}

export type BarcodeSymbology =
  | 'code128'
  | 'code39'
  | 'ean8'
  | 'ean13'
  | 'upca'
  | 'upce'
  | 'itf'
  | 'datamatrix'
  | 'pdf417'
  | 'aztec'
  | 'gs1-128';

export interface BarcodeElement extends ElementBase {
  type: 'barcode';
  symbology: BarcodeSymbology;
  value: Expression;
  showText?: boolean;
  quietZone?: Pt;
}

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrCodeElement extends ElementBase {
  type: 'qrcode';
  value: Expression;
  errorCorrection?: QrErrorCorrection;
  quietZone?: Pt;
}

export type ChartKind =
  | 'bar'
  | 'column'
  | 'stackedColumn'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'combo'
  | 'sparkline';

export interface ChartSeries {
  name?: string;
  /** Expression yielding the series values over the bound dataset. */
  values: Expression;
  kind?: ChartKind;
}

/** Data-bound, vector-rendered chart (§5, §11A-D). */
export interface ChartElement extends ElementBase {
  type: 'chart';
  chartKind: ChartKind;
  dataset: string;
  /** Category/label expression. */
  categories?: Expression;
  series: ChartSeries[];
  showLegend?: boolean;
  showLabels?: boolean;
}

export interface CrosstabMeasure {
  value: Expression;
  aggregate: Aggregate;
  label?: string;
}

/** Matrix with row/column groups, measures, totals/subtotals (§5). */
export interface CrosstabElement extends ElementBase {
  type: 'crosstab';
  dataset: string;
  rowGroups: Expression[];
  columnGroups: Expression[];
  measures: CrosstabMeasure[];
  showTotals?: boolean;
}

/** Embeds another template against its own (possibly related) dataset (§5). */
export interface SubreportElement extends ElementBase {
  type: 'subreport';
  /** Reference to a template (by id) or an inline expression source. */
  templateRef: string;
  /** Dataset expression supplying the subreport's root data. */
  dataset: Expression;
}

/** Built-in computed fields: page number/count, current date (§5). */
export interface PageFieldElement extends ElementBase {
  type: 'pageField';
  field: 'page' | 'pageCount' | 'currentDate';
  format?: FormatDescriptor;
}

/** Grouping container with optional background/border; children move together. */
export interface ContainerElement extends ElementBase {
  type: 'container';
  children: AnyElement[];
}

export interface SpacerElement extends ElementBase {
  type: 'spacer';
}

export interface PageBreakElement extends ElementBase {
  type: 'pageBreak';
}

/**
 * An interactive AcroForm field (§11A-A): a fillable text input or checkbox in
 * the generated PDF. The SVG preview shows a placeholder with the default value.
 */
export interface FormFieldElement extends ElementBase {
  type: 'formField';
  fieldKind: 'text' | 'checkbox';
  /** Unique AcroForm field name. */
  fieldName: string;
  /** Default value: text content, or a truthy value to pre-check a checkbox. */
  defaultValue?: Expression;
  /** Allow multi-line text input (text fields only). */
  multiline?: boolean;
}

/**
 * An extension element (§12): rendered by a {@link ElementRegistry} renderer
 * registered under `renderer`. The renderer receives the evaluated `value` and
 * `options` verbatim and returns neutral vector ops both painters draw — so
 * third-party elements (gauges, sparklines, seals, …) get WYSIWYG for free.
 */
export interface CustomElement extends ElementBase {
  type: 'custom';
  /** Registry key of the renderer to invoke. */
  renderer: string;
  /** Data-driven input, evaluated against the current scope. */
  value?: Expression;
  /** Static configuration passed through to the renderer untouched. */
  options?: Record<string, unknown>;
}

/** Discriminated union of every built-in element. */
export type AnyElement =
  | StaticTextElement
  | DataFieldElement
  | RichTextElement
  | ImageElement
  | TableElement
  | ListElement
  | LineElement
  | RectangleElement
  | EllipseElement
  | BarcodeElement
  | QrCodeElement
  | ChartElement
  | CrosstabElement
  | SubreportElement
  | PageFieldElement
  | ContainerElement
  | SpacerElement
  | PageBreakElement
  | FormFieldElement
  | CustomElement;
