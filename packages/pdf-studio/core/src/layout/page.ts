/**
 * The layout tree both painters consume (§7). Coordinates are in points with a
 * **top-left origin, y increasing downward** (the preview/DOM convention); the
 * PDF painter flips to PDF's bottom-left origin. Producing this tree is a pure
 * function of (template, data) — no DOM, deterministic (§6).
 */
import type { ExpressionDiagnostic } from '../expression/errors';
import type { ResolvedDirection } from '../binding/effective-locale';
import type { Color } from '../model/color';
import type { ElementType, IconName } from '../model/element-base';
import type { AnyElement, ChartKind, ImageFit } from '../model/elements';
import type { ImageMime } from '../model/resource';
import type { BoxStyle, HorizontalAlign, Typography } from '../model/style';
import type { Rect, Size } from '../model/units';

/** A styled run segment within a laid-out rich-text line. */
export interface LaidTextRun {
  text: string;
  fontFamily?: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  width: number;
}
export interface LaidTextLine {
  runs: LaidTextRun[];
  width: number;
  height: number;
}
export interface LaidParagraph {
  lines: LaidTextLine[];
  align: HorizontalAlign;
}
export interface LaidRichText {
  paragraphs: LaidParagraph[];
}

/** A 0–1 RGB color used by neutral vector draw-ops. */
export interface VecColor {
  r: number;
  g: number;
  b: number;
}

/**
 * A neutral vector draw-op in the element's local coordinate space (top-left
 * origin, y down). Charts and registered custom elements (§12) resolve to
 * these; both painters consume them identically (§7).
 */
export type VectorOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: VecColor }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: VecColor; width: number }
  | { op: 'path'; d: string; fill: VecColor }
  | {
      op: 'text';
      /** Anchor point; `y` is the baseline. */
      x: number;
      y: number;
      text: string;
      size: number;
      color: VecColor;
      /** Horizontal anchoring around `x`; defaults to `start`. */
      align?: 'start' | 'middle' | 'end';
    };

/** A resolved QR code: a square matrix of dark/light modules (§5). */
export interface LaidQr {
  modules: boolean[][];
  count: number;
}

/** A resolved image ready to paint (bytes via base64, or a URL). */
export interface LaidImage {
  mime: ImageMime;
  fit: ImageFit;
  base64?: string;
  url?: string;
}

/** A resolved, data-bound chart ready to paint as vector primitives (§5). */
export interface LaidChartSeries {
  name?: string;
  values: number[];
  /** Per-series override, honoured when the chart itself is a `combo` (§5). */
  kind?: ChartKind;
}
export interface LaidChart {
  kind: ChartKind;
  categories: string[];
  series: LaidChartSeries[];
  showLegend: boolean;
  /** Resolved direction: categories run right-to-left and the axis flips (§7). */
  rtl?: boolean;
  /**
   * Label widths measured with the document's real font at layout time. The
   * painters have no metrics of their own, and the old character-count estimate
   * was Latin-calibrated, so Persian legends overlapped or clipped. Optional:
   * `chartOps` falls back to the estimate when a `LaidChart` is built by hand.
   */
  seriesNameWidths?: number[];
  categoryWidths?: number[];
}

/** One element placed on a page with absolute geometry and resolved content. */
export interface LaidOutElement {
  id: string;
  type: ElementType;
  /** Absolute page coordinates (pt, top-left origin). */
  bounds: Rect;
  rotation: number;
  zIndex: number;
  direction: ResolvedDirection;
  /** Resolved display text, for text-bearing elements. */
  text?: string;
  /** Wrapped visual lines, when the element was measured. */
  lines?: string[];
  /** Barcode module bits (true = bar), painted as vector bars (§5). */
  barcode?: boolean[];
  /** Human-readable barcode value drawn under the bars when `showText` (§5). */
  barcodeText?: string;
  /** QR code module matrix (true = dark), painted as vector squares (§5). */
  qr?: LaidQr;
  /** Resolved image to paint (§5). */
  image?: LaidImage;
  /** Resolved data-bound chart to paint as vector (§5). */
  chart?: LaidChart;
  /** Resolved multi-run rich text, wrapped into lines (§5). */
  richText?: LaidRichText;
  /** Resolved PDF outline (bookmark) entry for this element (§11A-D). */
  bookmark?: { title: string; level: number };
  /** Resolved clickable hyperlink: external URL or 1-based page jump (§11A-D). */
  link?: { kind: 'url'; url: string } | { kind: 'page'; page: number };
  /** Resolved proportional data bar (fraction 0–1) drawn behind content (§11A-D). */
  dataBar?: { fraction: number; color: Color };
  /** Resolved vector ops from a registered custom-element renderer (§12). */
  custom?: VectorOp[];
  /** Resolved interactive AcroForm field to emit in the PDF (§11A-A). */
  formField?: {
    kind: 'text' | 'checkbox';
    name: string;
    value: string;
    checked: boolean;
    multiline: boolean;
  };
  /** Resolved value-driven status icon drawn at the start edge (§11A-D). */
  icon?: { name: IconName; color: Color };
  /**
   * Repeat this element at the top of every continuation chunk when its band
   * is split across pages (§6) — set on table header cells.
   */
  repeatOnSplit?: boolean;
  /** Merged typography (named style ⊕ inline); painter applies defaults. */
  typography?: Typography;
  /** Merged box style (named style ⊕ inline). */
  box?: BoxStyle;
  /** Back-reference to the source element for painter-specific properties. */
  source: AnyElement;
}

export interface LayoutPage {
  /** 0-based page index. */
  index: number;
  /** 1-based page number (`$page`). */
  number: number;
  size: Size;
  /** Elements in paint order (ascending zIndex). */
  elements: LaidOutElement[];
}

/** A flattened PDF outline entry, in document order (§11A-D). */
export interface BookmarkEntry {
  title: string;
  level: number;
  pageIndex: number;
  /** Top y (layout coords) of the target element on its page. */
  y: number;
}

export interface PaginatedDocument {
  pages: LayoutPage[];
  pageCount: number;
  diagnostics: ExpressionDiagnostic[];
  /** PDF outline entries collected from elements' `bookmark`, in order. */
  bookmarks: BookmarkEntry[];
}
