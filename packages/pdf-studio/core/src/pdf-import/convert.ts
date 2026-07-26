/**
 * Reverse import (ROADMAP ۵.۱), step 2: turn extracted PDF content into an
 * editable {@link PdfTemplate}. Pure and deterministic — all pdfjs specifics
 * live in `extract.ts`.
 *
 * Geometry: the PDF painter puts a text baseline at `bounds.y + 0.8×fontSize`
 * (see `paint/pdf-painter.ts`), so the inverse `y = pageH − baseline − 0.8×fs`
 * makes importing our own output land on the original coordinates exactly;
 * foreign PDFs are off by at most the ascent difference (fraction of a point
 * to ~0.2 em). Each text run keeps its own `direction` with `align: start`, so
 * LTR runs anchor their left edge and RTL runs their right edge — the width
 * padding (against wrap when our measurer is slightly wider than the source
 * font's) grows away from the anchored edge and never moves the text.
 */
import type { RgbColor } from '../model/color';
import type { AnyElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';
import type { ExtractedPage } from './types';

export interface PdfImportOptions {
  /** Template name (default: 'Imported PDF'). */
  name?: string;
  /** Max recovered line/rectangle elements per page (default 400). */
  maxGraphicsPerPage?: number;
  /**
   * Filled rectangles smaller than this (both sides, pt) are dropped — they
   * are almost always QR modules / barcode marks, not layout (default 4).
   */
  minMarkSize?: number;
}

export interface PdfImportResult {
  template: PdfTemplate;
  /** Non-fatal notes (skipped curves/images/tiny marks, capped graphics…). */
  warnings: string[];
}

/** Matches the PDF painter's baseline placement (`ascent = 0.8 × fontSize`). */
const ASCENT_FACTOR = 0.8;
/** Matches `DEFAULT_LINE_HEIGHT` in `paint/paint-style.ts`. */
const LINE_HEIGHT = 1.2;

/**
 * Arabic-script ranges (Arabic, Supplement, Extended-A, Presentation Forms A/B).
 * Written as escapes: the literal range ends at U+FEFF, an invisible character
 * that lints as irregular whitespace and is unreadable in source.
 */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const round = (v: number): number => Math.round(v * 100) / 100;
const isBlack = (c: RgbColor | undefined): boolean => !c || (c.r === 0 && c.g === 0 && c.b === 0);

/** Convert extracted pages into an editable template (one band per page). */
export function pdfContentToTemplate(
  pages: ExtractedPage[],
  options: PdfImportOptions = {},
): PdfImportResult {
  if (pages.length === 0) throw new Error('pdfContentToTemplate: no pages');
  const first = pages[0] as ExtractedPage;
  const maxGraphics = options.maxGraphicsPerPage ?? 400;
  const minMark = options.minMarkSize ?? 4;
  const warnings: string[] = [];
  let uid = 0;
  const nextId = (): string => `el-${++uid}`;

  const rtlCount = pages.reduce((n, p) => n + p.texts.filter((t) => t.dir === 'rtl').length, 0);
  const textCount = pages.reduce((n, p) => n + p.texts.length, 0);
  const rtl = rtlCount * 2 >= textCount && rtlCount > 0;

  const bands = pages.map((page, pageIndex) => {
    const elements: AnyElement[] = [];
    let tinyMarks = 0;

    for (const rect of page.rects) {
      if (rect.fill && rect.width < minMark && rect.height < minMark) {
        tinyMarks++;
        continue;
      }
      elements.push({
        id: nextId(),
        type: 'rectangle',
        bounds: {
          x: round(rect.x),
          y: round(page.height - rect.y - rect.height),
          width: round(rect.width),
          height: round(rect.height),
        },
        zIndex: 1,
        box: {
          ...(rect.fill ? { fill: { color: rect.fill } } : {}),
          ...(rect.stroke
            ? { border: { all: { width: rect.lineWidth, color: rect.stroke } } }
            : {}),
        },
      });
    }

    for (const seg of page.segments) {
      // lines have no direction — normalize so width is non-negative
      const [a, b] = seg.x1 <= seg.x2 ? [seg.x1, seg.x2] : [seg.x2, seg.x1];
      const [ya, yb] = seg.x1 <= seg.x2 ? [seg.y1, seg.y2] : [seg.y2, seg.y1];
      elements.push({
        id: nextId(),
        type: 'line',
        bounds: {
          x: round(a),
          y: round(page.height - ya),
          width: round(b - a),
          height: round(ya - yb),
        },
        zIndex: 1,
        stroke: { width: seg.lineWidth, color: seg.color ?? { space: 'rgb', r: 0, g: 0, b: 0 } },
      });
    }

    if (tinyMarks > 0) {
      warnings.push(
        `page ${pageIndex + 1}: ${tinyMarks} tiny filled mark(s) skipped (QR/barcode modules)`,
      );
    }
    const graphicsCount = elements.length;
    if (graphicsCount > maxGraphics) {
      elements.length = maxGraphics;
      warnings.push(
        `page ${pageIndex + 1}: graphics capped at ${maxGraphics} (had ${graphicsCount})`,
      );
    }

    for (const text of page.texts) {
      const pad = Math.max(2, text.width * 0.08);
      const persian = ARABIC_SCRIPT.test(text.text);
      elements.push({
        id: nextId(),
        type: 'staticText',
        bounds: {
          // RTL anchors its right edge, LTR its left — padding grows the other way
          x: round(text.dir === 'rtl' ? text.x + text.width - (text.width + pad) : text.x),
          y: round(page.height - text.y - ASCENT_FACTOR * text.fontSize),
          width: round(text.width + pad),
          height: round(text.fontSize * LINE_HEIGHT),
        },
        zIndex: 2,
        text: text.text,
        direction: text.dir,
        typography: {
          fontSize: round(text.fontSize),
          align: 'start',
          ...(persian ? { fontFamily: 'Vazirmatn' } : {}),
          ...(text.color && !isBlack(text.color) ? { color: text.color } : {}),
        },
      });
    }

    warnings.push(...page.warnings.map((w) => `page ${pageIndex + 1}: ${w}`));

    return {
      id: `page-${pageIndex + 1}`,
      type: 'reportHeader' as const,
      height: { mode: 'fixed' as const, value: round(page.height) },
      elements,
      ...(pageIndex > 0 ? { pageBreakBefore: true } : {}),
    };
  });

  const template: PdfTemplate = {
    schemaVersion: '1.0.0',
    metadata: { name: options.name ?? 'Imported PDF' },
    page: {
      size: { width: round(first.width), height: round(first.height) },
      orientation: first.width > first.height ? 'landscape' : 'portrait',
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      direction: rtl ? 'rtl' : 'ltr',
      locale: rtl
        ? { language: 'fa', digits: 'latn', calendar: 'jalali' }
        : { language: 'en', digits: 'latn', calendar: 'gregorian' },
      unit: 'pt',
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands,
    resources: { fonts: [], images: [] },
  };

  return { template, warnings };
}
