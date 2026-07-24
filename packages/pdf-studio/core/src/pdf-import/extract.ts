/**
 * Reverse import (ROADMAP ۵.۱), step 1: pull text runs + simple vector
 * graphics out of a pdfjs document, in raw PDF coordinates. Text comes from
 * `getTextContent()` (logical order, ToUnicode-mapped — RTL round-trips); lines
 * and rectangles are recovered from the page operator list by tracking the
 * graphics state (CTM, colors, line width) and decoding `constructPath`.
 */
import type { RgbColor } from '../model/color';
import type {
  ExtractedPage,
  ExtractedRect,
  ExtractedSegment,
  PdfjsDocumentLike,
  PdfjsOperatorListLike,
  PdfjsTextItemLike,
} from './types';

/**
 * pdfjs public operator codes (`OPS` in pdfjs-dist). Hardcoded so `core` does
 * not import pdfjs; these values are part of pdfjs' stable public surface.
 */
const OPS = {
  setLineWidth: 2,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  constructPath: 91,
} as const;

const STROKE_OPS = new Set<number>([OPS.stroke, OPS.closeStroke]);
const FILL_OPS = new Set<number>([OPS.fill, OPS.eoFill]);
const FILL_STROKE_OPS = new Set<number>([
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);
const TEXT_SHOW_OPS = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText]);

/** [a, b, c, d, e, f] affine matrix (PDF row-vector convention). */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** CTM update for a `cm` op: apply `m` first, then `old` (PDF semantics). */
function concat(old: Matrix, m: Matrix): Matrix {
  return [
    m[0] * old[0] + m[1] * old[2],
    m[0] * old[1] + m[1] * old[3],
    m[2] * old[0] + m[3] * old[2],
    m[2] * old[1] + m[3] * old[3],
    m[4] * old[0] + m[5] * old[2] + old[4],
    m[4] * old[1] + m[5] * old[3] + old[5],
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function toRgb(args: unknown): RgbColor | undefined {
  const a = args as ArrayLike<number> | undefined;
  if (!a || typeof a[0] !== 'number' || typeof a[1] !== 'number' || typeof a[2] !== 'number') {
    return undefined;
  }
  return { space: 'rgb', r: a[0], g: a[1], b: a[2] };
}

interface GfxState {
  ctm: Matrix;
  fill: RgbColor | undefined;
  stroke: RgbColor | undefined;
  lineWidth: number;
}

interface SubPath {
  points: Array<{ x: number; y: number }>;
  closed: boolean;
  hasCurve: boolean;
}

/** Decode a `constructPath` into subpaths of straight points (device space). */
function decodePath(args: unknown[], ctm: Matrix): SubPath[] {
  const ops = args[0] as ArrayLike<number>;
  const coords = args[1] as ArrayLike<number>;
  const paths: SubPath[] = [];
  let current: SubPath | null = null;
  let ci = 0;
  const point = (): { x: number; y: number } => {
    const p = apply(ctm, coords[ci] as number, coords[ci + 1] as number);
    ci += 2;
    return p;
  };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op === OPS.moveTo) {
      const p = point();
      // pdf-lib emits a doubled moveTo for plain lines — collapse empty paths.
      if (!current || current.points.length > 1) {
        current = { points: [p], closed: false, hasCurve: false };
        paths.push(current);
      } else {
        current.points = [p];
      }
    } else if (op === OPS.lineTo) {
      const p = point();
      if (current) current.points.push(p);
    } else if (op === OPS.closePath) {
      if (current) current.closed = true;
    } else if (op === OPS.rectangle) {
      const x = coords[ci] as number;
      const y = coords[ci + 1] as number;
      const w = coords[ci + 2] as number;
      const h = coords[ci + 3] as number;
      ci += 4;
      const p1 = apply(ctm, x, y);
      const p2 = apply(ctm, x + w, y);
      const p3 = apply(ctm, x + w, y + h);
      const p4 = apply(ctm, x, y + h);
      paths.push({ points: [p1, p2, p3, p4], closed: true, hasCurve: false });
      current = null;
    } else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
      ci += op === OPS.curveTo ? 6 : 4;
      if (current) current.hasCurve = true;
    }
  }
  return paths;
}

const EPS = 0.01;

/** A closed 4-point axis-aligned subpath → rectangle, else undefined. */
function asRectangle(path: SubPath): { x: number; y: number; w: number; h: number } | undefined {
  if (path.hasCurve) return undefined;
  let pts = path.points;
  // tolerate an explicit closing point repeating the start
  if (
    pts.length === 5 &&
    Math.abs((pts[0] as { x: number }).x - (pts[4] as { x: number }).x) < EPS &&
    Math.abs((pts[0] as { y: number }).y - (pts[4] as { y: number }).y) < EPS
  ) {
    pts = pts.slice(0, 4);
  }
  if (pts.length !== 4 || !path.closed) return undefined;
  for (let i = 0; i < 4; i++) {
    const a = pts[i] as { x: number; y: number };
    const b = pts[(i + 1) % 4] as { x: number; y: number };
    const straight = Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS;
    if (!straight) return undefined;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  return w < EPS || h < EPS ? undefined : { x, y, w, h };
}

/** Walk the operator list, collecting simple graphics + per-show fill colors. */
function walkOperators(
  opList: PdfjsOperatorListLike,
  out: { segments: ExtractedSegment[]; rects: ExtractedRect[]; warnings: string[] },
): RgbColor[] {
  let state: GfxState = { ctm: IDENTITY, fill: undefined, stroke: undefined, lineWidth: 1 };
  const stack: GfxState[] = [];
  const showColors: RgbColor[] = [];
  let pending: SubPath[] = [];
  let skippedCurves = 0;
  let skippedImages = 0;

  const paintPending = (fill: boolean, stroke: boolean): void => {
    for (const path of pending) {
      if (path.hasCurve) {
        skippedCurves++;
        continue;
      }
      const rect = asRectangle(path);
      if (rect) {
        out.rects.push({
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
          ...(fill && state.fill ? { fill: state.fill } : fill ? { fill: BLACK } : {}),
          ...(stroke ? { stroke: state.stroke ?? BLACK } : {}),
          lineWidth: state.lineWidth,
        });
        continue;
      }
      if (!stroke) continue; // filled free-form polygons: out of v1 scope
      for (let i = 0; i + 1 < path.points.length; i++) {
        const a = path.points[i] as { x: number; y: number };
        const b = path.points[i + 1] as { x: number; y: number };
        out.segments.push({
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          lineWidth: state.lineWidth,
          ...(state.stroke ? { color: state.stroke } : {}),
        });
      }
    }
    pending = [];
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i] as number;
    const args = opList.argsArray[i] as unknown[];
    if (fn === OPS.save) {
      stack.push(state);
      state = { ...state };
    } else if (fn === OPS.restore) {
      state = stack.pop() ?? state;
    } else if (fn === OPS.transform) {
      state.ctm = concat(state.ctm, args as unknown as Matrix);
    } else if (fn === OPS.setFillRGBColor) {
      state.fill = toRgb(args);
    } else if (fn === OPS.setStrokeRGBColor) {
      state.stroke = toRgb(args);
    } else if (fn === OPS.setLineWidth) {
      state.lineWidth = typeof args?.[0] === 'number' ? (args[0] as number) : state.lineWidth;
    } else if (fn === OPS.constructPath) {
      pending = decodePath(args, state.ctm);
    } else if (STROKE_OPS.has(fn)) {
      paintPending(false, true);
    } else if (FILL_OPS.has(fn)) {
      paintPending(true, false);
    } else if (FILL_STROKE_OPS.has(fn)) {
      paintPending(true, true);
    } else if (fn === OPS.endPath) {
      pending = [];
    } else if (TEXT_SHOW_OPS.has(fn)) {
      showColors.push(state.fill ?? BLACK);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      skippedImages++;
    }
  }
  if (skippedCurves > 0) out.warnings.push(`${skippedCurves} curved path(s) skipped`);
  if (skippedImages > 0) out.warnings.push(`${skippedImages} image(s) skipped`);
  return showColors;
}

const BLACK: RgbColor = { space: 'rgb', r: 0, g: 0, b: 0 };

/** Extract text + simple graphics from every page of a pdfjs document. */
export async function extractPdfContent(doc: PdfjsDocumentLike): Promise<ExtractedPage[]> {
  const pages: ExtractedPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const result: ExtractedPage = {
      width: viewport.width,
      height: viewport.height,
      texts: [],
      segments: [],
      rects: [],
      warnings: [],
    };

    let showColors: RgbColor[] = [];
    try {
      const opList = await page.getOperatorList();
      showColors = walkOperators(opList, result);
    } catch {
      result.warnings.push('operator list unavailable — lines/rectangles not recovered');
    }

    const content = await page.getTextContent();
    const items = content.items.filter(
      (item): item is PdfjsTextItemLike =>
        typeof (item as PdfjsTextItemLike).str === 'string' &&
        (item as PdfjsTextItemLike).str.trim().length > 0,
    );
    // Text draw order matches the show ops only when pdfjs did not merge or
    // split runs; when counts disagree we drop colors rather than guess.
    const colorsAligned = showColors.length === items.length;
    items.forEach((item, index) => {
      const t = item.transform;
      const fontSize = Math.hypot(t[2] as number, t[3] as number) || (item.height ?? 12);
      result.texts.push({
        text: item.str,
        dir: item.dir === 'rtl' ? 'rtl' : 'ltr',
        x: t[4] as number,
        y: t[5] as number,
        fontSize,
        width: item.width,
        ...(colorsAligned ? { color: showColors[index] as RgbColor } : {}),
      });
    });
    if (!colorsAligned && items.length > 0 && showColors.length > 0) {
      result.warnings.push('text colors could not be recovered reliably — defaulting to black');
    }
    pages.push(result);
  }
  return pages;
}
