/**
 * Common base shared by every element. All elements are positioned relative to
 * their containing band (§5). Direction/locale optionally override the document
 * default; `visibleWhen`/`printWhen` give conditional rendering. Concrete shapes
 * live in `elements.ts`.
 */
import type { Color, RgbColor } from './color';
import type { Expression } from './expression';
import type { Direction, LocaleSetup } from './locale';
import type { BoxStyle, ConditionalStyle, Typography } from './style';
import type { Rect } from './units';

/** Discriminant for the {@link AnyElement} union. */
export type ElementType =
  | 'staticText'
  | 'dataField'
  | 'richText'
  | 'image'
  | 'table'
  | 'list'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'barcode'
  | 'qrcode'
  | 'chart'
  | 'crosstab'
  | 'subreport'
  | 'pageField'
  | 'container'
  | 'spacer'
  | 'pageBreak'
  | 'formField'
  | 'custom'
  | 'toc';

/**
 * A clickable hyperlink on an element (§11A-D): `url` opens an external link,
 * `page` jumps to a 1-based page number in the document (drill-through). The
 * target is an expression, so links can be data-driven.
 */
export type ElementLink =
  | { kind: 'url'; target: Expression }
  | { kind: 'page'; target: Expression };

/**
 * A proportional data bar drawn behind an element's content (§11A-D): a filled
 * rectangle whose width is `(value − min) / (max − min)` of the element width,
 * growing from the start edge (right in RTL). Like a spreadsheet data bar.
 */
export interface DataBar {
  value: Expression;
  /** Range floor; defaults to 0. */
  min?: number;
  /** Range ceiling. */
  max: number;
  color: Color;
}

/**
 * A color scale fill (§11A-D): the element's background is the color
 * interpolated (in sRGB) between the two stops surrounding `value`. Stops need
 * not be pre-sorted. Like a 2- or 3-color spreadsheet color scale.
 */
export interface ColorScale {
  value: Expression;
  stops: Array<{ at: number; color: RgbColor }>;
}

/** Built-in icon-set glyphs drawn as vectors (§11A-D). */
export type IconName = 'circle' | 'square' | 'triangleUp' | 'triangleDown';

/**
 * An icon set (§11A-D): draw a small status glyph at the element's start edge,
 * chosen by `value`. The glyph for the highest threshold `at` ≤ value applies
 * (values below the lowest threshold use the lowest). Like a spreadsheet icon
 * set (e.g. red/amber/green traffic lights, up/down arrows).
 */
export interface IconSet {
  value: Expression;
  thresholds: Array<{ at: number; icon: IconName; color?: RgbColor }>;
}

/** A PDF outline (bookmark) entry on an element (§11A-D). */
export interface ElementBookmark {
  /** Nesting depth (0 = top level). */
  level?: number;
  /** Bookmark label; defaults to the element's resolved text when omitted. */
  title?: Expression;
}

export interface ElementBase {
  id: string;
  type: ElementType;
  /**
   * Author-facing label shown in the designer's layer list (§8A). Purely an
   * editing aid — it never affects rendering. Defaults to the element's type
   * and content when absent.
   */
  name?: string;
  /**
   * Editor-only lock (§8A): the designer will not let the author move, resize,
   * or delete this element, though it stays selectable and fully visible. Has
   * no effect on layout or paint.
   */
  locked?: boolean;
  /** Band-relative bounds, in points. */
  bounds: Rect;
  /** Clockwise rotation in degrees. */
  rotation?: number;
  zIndex: number;
  /** Reference into `PdfTemplate.styles`. */
  styleId?: string;
  /** Inline typography override (highest precedence in the cascade, §4). */
  typography?: Typography;
  /** Inline box (fill/border/padding/opacity) override. */
  box?: BoxStyle;
  /** Data-driven style overlays applied when their condition is truthy (§11A-D). */
  conditionalStyles?: ConditionalStyle[];
  /** Emit a PDF outline (bookmark) entry pointing at this element (§11A-D). */
  bookmark?: ElementBookmark;
  /** Make this element a clickable hyperlink (external URL or page jump). */
  link?: ElementLink;
  /** Draw a proportional data bar behind this element's content (§11A-D). */
  dataBar?: DataBar;
  /** Fill this element with a value-driven color scale (§11A-D). */
  colorScale?: ColorScale;
  /** Draw a value-driven status icon at this element's start edge (§11A-D). */
  iconSet?: IconSet;
  /** Override document direction; `'auto'` = bidi-detect from content. */
  direction?: Direction;
  /** Override language/digits/calendar for this element. */
  locale?: Partial<LocaleSetup>;
  /** Conditional rendering (layout + paint). */
  visibleWhen?: Expression;
  /** Conditional, render-only (occupies layout space, omitted from paint). */
  printWhen?: Expression;
}
