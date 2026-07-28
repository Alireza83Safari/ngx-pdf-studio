/**
 * Reverse import (ROADMAP ۵.۱): shared types. The extractor talks to pdfjs
 * **structurally** — the interfaces below describe just the slice of the pdfjs
 * API it touches, so `core` never imports `pdfjs-dist` (it stays a
 * devDependency, same policy as `testing/extract-pdf-text.ts`). Callers pass a
 * document obtained from *their* pdfjs (`getDocument(...).promise`).
 */
import type { RgbColor } from '../model/color';

/** One `getTextContent()` item — the fields the extractor reads. */
export interface PdfjsTextItemLike {
  str: string;
  /** 'ltr' | 'rtl' | 'ttb' as reported by pdfjs. */
  dir?: string;
  /** Text matrix [a, b, c, d, e, f]; e/f = baseline origin, PDF space (y-up). */
  transform: number[];
  /** Advance width of the item, pt. */
  width: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PdfjsTextContentLike {
  items: PdfjsTextItemLike[];
}

/** `getOperatorList()` result — parallel op-code / arguments arrays. */
export interface PdfjsOperatorListLike {
  fnArray: number[];
  argsArray: unknown[];
}

export interface PdfjsPageLike {
  getViewport(params: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<PdfjsTextContentLike>;
  getOperatorList(): Promise<PdfjsOperatorListLike>;
}

/** The slice of `PDFDocumentProxy` the importer needs. */
export interface PdfjsDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPageLike>;
}

/** A text run in raw PDF coordinates (origin bottom-left, y grows up). */
export interface ExtractedText {
  text: string;
  dir: 'ltr' | 'rtl';
  /** Baseline origin, PDF space. */
  x: number;
  y: number;
  fontSize: number;
  /** Advance width as measured by pdfjs, pt. */
  width: number;
  /** Fill color at draw time, when it could be recovered (default: black). */
  color?: RgbColor;
}

/** A straight stroked segment in raw PDF coordinates. */
export interface ExtractedSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lineWidth: number;
  color?: RgbColor;
}

/** An axis-aligned rectangle (filled and/or stroked) in raw PDF coordinates. */
export interface ExtractedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: RgbColor;
  stroke?: RgbColor;
  lineWidth: number;
}

/**
 * Where an image (logo, stamp, signature) was painted, in raw PDF coordinates.
 * Only the *placement* is recovered — decoding the XObject's pixels is a
 * separate job — but that is enough to keep the slot in a cloned layout instead
 * of silently dropping it and leaving a hole.
 */
export interface ExtractedImage {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything recovered from one PDF page. */
export interface ExtractedPage {
  width: number;
  height: number;
  texts: ExtractedText[];
  segments: ExtractedSegment[];
  rects: ExtractedRect[];
  /** Optional so a hand-built page (tests, tools) stays valid without it. */
  images?: ExtractedImage[];
  /** Non-fatal notes: skipped curves, tiny marks, … */
  warnings: string[];
}
