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

export interface RenderOptions {
  paginate?: PaginateOptions;
  pdf?: PdfPaintOptions;
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
  return paginate(template, createRenderContext(input), options.paginate);
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
