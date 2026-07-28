/**
 * Format Cloner (Moonshot F2), stretch goal **F4.1** — clone a format from a
 * *photo* instead of a PDF.
 *
 * A PDF carries its own text runs and coordinates, which is what
 * {@link extractPdfContent} recovers. A photograph carries none, so a
 * vision-capable {@link CopilotProvider} stands in for the extractor: it reads
 * the image and reports the text it sees with a box for each run. The result is
 * an ordinary {@link ExtractedPage}, so everything downstream — the heuristic
 * classifier, schema inference, table detection, binding — is reused unchanged.
 *
 * The model is asked for boxes in a normalised 0–1000 space rather than points:
 * it does not know the page size, and normalised coordinates are markedly more
 * reliable than absolute ones. They are scaled to the caller's page size here.
 */
import type { CopilotProvider, VisionImage } from '../copilot/provider';
import { extractJson } from '../copilot/generate';
import { cloneFormat, type CloneFormatOptions, type CloneFormatResult } from './clone';
import type { ExtractedPage, ExtractedText } from './types';

/** A4 at 72dpi — the default when the caller does not say otherwise. */
const DEFAULT_PAGE = { width: 595.28, height: 841.89 };
const GRID = 1000;

export const IMAGE_EXTRACT_CONTRACT = `You are reading a photograph or scan of a printed business document (an invoice, form, receipt, or report) so it can be rebuilt as a reusable template.

Report EVERY piece of text you can read, as a list of runs. A "run" is one visually contiguous piece of text — a label, a value, a heading, one cell of a table. Do not merge separate cells or separate lines into one run.

For each run give:
- "text": exactly what is printed, transcribed verbatim. Keep the original language and digits.
- "x", "y": the top-left corner of the run, on a 0-1000 grid where x=0 is the left edge of the page, y=0 is the TOP edge.
- "w": the run's width on the same 0-1000 grid.
- "h": the run's height (cap height of the line) on the same 0-1000 grid.
- "rtl": true if the run is right-to-left script (Persian, Arabic, Hebrew), else false.

Read in the document's own reading order, top to bottom. Preserve the column alignment of tabular data: cells in the same column must share a similar x.

Reply with ONLY JSON: {"runs":[{"text":"Invoice","x":40,"y":30,"w":120,"h":22,"rtl":false}, ...]}.
Report no other keys. If the image is unreadable, reply {"runs":[]}.`;

export interface ImageImportOptions {
  /** Page size in points for the rebuilt template (default A4 portrait). */
  pageWidth?: number;
  pageHeight?: number;
  /** Extra instruction appended to the contract (e.g. "this is a Persian invoice"). */
  hint?: string;
}

interface RawRun {
  text?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  rtl?: unknown;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Read an image with `vision` and return it as an {@link ExtractedPage}.
 *
 * Runs the model cannot place, or that carry no text, are dropped rather than
 * guessed at — a missing run degrades the clone, a fabricated one corrupts it.
 * An unreadable image yields a page with no texts (and a warning), never a throw.
 */
export async function imageToPage(
  image: VisionImage,
  vision: CopilotProvider,
  options: ImageImportOptions = {},
): Promise<ExtractedPage> {
  const width = options.pageWidth ?? DEFAULT_PAGE.width;
  const height = options.pageHeight ?? DEFAULT_PAGE.height;
  const page: ExtractedPage = {
    width,
    height,
    texts: [],
    segments: [],
    rects: [],
    images: [],
    warnings: [],
  };

  let reply: string;
  try {
    reply = await vision.complete(IMAGE_EXTRACT_CONTRACT, [
      { role: 'user', content: options.hint ?? 'Read this document.', image },
    ]);
  } catch (err) {
    page.warnings.push(
      `vision provider failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return page;
  }

  // `extractJson` returns the JSON *slice*, not a parsed value
  const slice = extractJson(reply);
  let parsed: { runs?: unknown } | null = null;
  if (slice !== null) {
    try {
      parsed = JSON.parse(slice) as { runs?: unknown };
    } catch {
      parsed = null;
    }
  }
  const runs = parsed && Array.isArray(parsed.runs) ? (parsed.runs as RawRun[]) : null;
  if (!runs) {
    page.warnings.push('vision provider did not return a readable run list');
    return page;
  }

  let dropped = 0;
  for (const run of runs) {
    const text = typeof run.text === 'string' ? run.text.trim() : '';
    const x = num(run.x);
    const y = num(run.y);
    const w = num(run.w);
    const h = num(run.h);
    if (!text || x === undefined || y === undefined || w === undefined || h === undefined) {
      dropped++;
      continue;
    }
    const fontSize = Math.max(4, (h / GRID) * height);
    // the grid's y grows downward and its origin is the top; PDF space grows up
    // from the bottom, and `ExtractedText.y` is a *baseline*
    const top = (y / GRID) * height;
    const laid: ExtractedText = {
      text,
      dir: run.rtl === true ? 'rtl' : 'ltr',
      x: (x / GRID) * width,
      y: height - top - fontSize,
      fontSize,
      width: (w / GRID) * width,
    };
    page.texts.push(laid);
  }
  if (dropped > 0) page.warnings.push(`${dropped} unreadable run(s) dropped`);
  if (page.texts.length === 0) page.warnings.push('no text recovered from the image');
  return page;
}

export interface CloneFormatImageOptions extends CloneFormatOptions, ImageImportOptions {
  /** Vision-capable provider that reads the image (required). */
  vision: CopilotProvider;
}

/**
 * Photo → editable, data-bound template in one call: read the image, then hand
 * the recovered page to the existing {@link cloneFormat} pipeline.
 */
export async function cloneFormatImage(
  image: VisionImage,
  options: CloneFormatImageOptions,
): Promise<CloneFormatResult> {
  const page = await imageToPage(image, options.vision, options);
  const result = await cloneFormat([page], options);
  return { ...result, warnings: [...page.warnings, ...result.warnings] };
}
