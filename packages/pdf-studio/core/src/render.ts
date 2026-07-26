/**
 * High-level render entry points (§7, §12). Both targets flow through the same
 * pipeline: `createRenderContext → paginate → paint`. The SVG and PDF painters
 * consume the **same** `Page[]` layout tree, so preview and PDF agree by
 * construction. These pure functions are the engine the Angular renderer and the
 * Node entry point both wrap.
 */
import { createRenderContext, type RenderContextInput } from './binding/render-context';
import type { ExpressionDiagnostic } from './expression/errors';
import { paginate, type PaginateOptions } from './layout/paginate';
import type { PaginatedDocument } from './layout/page';
import { paintToPdf, type PdfPaintOptions } from './paint/pdf-painter';
import { paintToSvg } from './paint/svg-painter';
import type { PdfTemplate } from './model/template';
import { stampVerification, type StampOptions } from './verify/stamp';

/**
 * Verification-stamp options for {@link RenderOptions.verify}. The hashed
 * `data`/`parameters`/`now` come from the render `input`, so only the
 * presentation choices are configurable here.
 */
export type VerifyRenderOptions = Omit<StampOptions, 'data' | 'parameters' | 'now'>;

export interface RenderOptions {
  paginate?: PaginateOptions;
  pdf?: PdfPaintOptions;
  /**
   * Stamp a tamper-evident verification mark (QR + short code) onto the output
   * (F1). `true` uses defaults; pass an object to set the verify URL, size,
   * label, etc. The mark hashes the same `input` that is rendered.
   */
  verify?: boolean | VerifyRenderOptions;
}

/** Apply the verification stamp (F1) when requested, else pass the template through. */
function withVerification(
  template: PdfTemplate,
  input: RenderContextInput,
  options: RenderOptions,
): PdfTemplate {
  if (!options.verify) return template;
  const stampInput: StampOptions = options.verify === true ? {} : { ...options.verify };
  // pull the hashed inputs from the render input (avoid assigning `undefined`
  // under exactOptionalPropertyTypes)
  if (input.data !== undefined) stampInput.data = input.data;
  if (input.parameters !== undefined) stampInput.parameters = input.parameters;
  if (input.now !== undefined) stampInput.now = input.now;
  return stampVerification(template, stampInput);
}

export interface PdfRenderResult {
  bytes: Uint8Array;
  pageCount: number;
  diagnostics: ExpressionDiagnostic[];
}

export interface SvgRenderResult {
  /** One SVG document string per page. */
  pages: string[];
  pageCount: number;
  diagnostics: ExpressionDiagnostic[];
}

/** Produce the shared layout tree for `template` + `input` (no painting). */
export function layoutDocument(
  template: PdfTemplate,
  input: RenderContextInput = {},
  options: RenderOptions = {},
): PaginatedDocument {
  const finalTemplate = withVerification(template, input, options);
  return paginate(finalTemplate, createRenderContext(input), options.paginate);
}

/** Render to a real PDF (`Uint8Array`). */
export async function renderToPdf(
  template: PdfTemplate,
  input: RenderContextInput = {},
  options: RenderOptions = {},
): Promise<PdfRenderResult> {
  const doc = layoutDocument(template, input, options);
  const bytes = await paintToPdf(doc, options.pdf);
  return { bytes, pageCount: doc.pageCount, diagnostics: doc.diagnostics };
}

/** Render to SVG (one string per page) for preview. */
export function renderToSvg(
  template: PdfTemplate,
  input: RenderContextInput = {},
  options: RenderOptions = {},
): SvgRenderResult {
  const doc = layoutDocument(template, input, options);
  return { pages: paintToSvg(doc), pageCount: doc.pageCount, diagnostics: doc.diagnostics };
}
