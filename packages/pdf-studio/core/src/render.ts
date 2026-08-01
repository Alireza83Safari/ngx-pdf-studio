/**
 * High-level render entry points (§7, §12). Both targets flow through the same
 * pipeline: `createRenderContext → paginate → paint`. The SVG and PDF painters
 * consume the **same** `Page[]` layout tree, so preview and PDF agree by
 * construction. These pure functions are the engine the Angular renderer and the
 * Node entry point both wrap.
 */
import { createRenderContext, type RenderContextInput } from './binding/render-context';
import type { ExpressionDiagnostic } from './expression/errors';
import { withLogicalBounds } from './layout/logical-bounds';
import { paginate, type PaginateOptions } from './layout/paginate';
import type { PaginatedDocument } from './layout/page';
import type { TextMeasurer } from './layout/measure';
import { createTemplateMeasurer } from './layout/template-measurer';
import type { FontInput } from './paint/font-provider';
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
  // Order matters: the verification hash must cover the template *as authored*,
  // so that the code the designer shows live, the code printed on the paper and
  // the code `verify.html` recomputes are all the same (F1.5). Mirroring runs
  // after, and carries the stamp band along to the mirrored side of the page.
  const stamped = withVerification(template, input, options);
  return paginate(withLogicalBounds(stamped), createRenderContext(input), {
    ...options.paginate,
    // Measure with the faces this document will actually be drawn with (§7).
    // An explicit measurer still wins: a caller who supplied one has said what
    // they want measured with.
    ...(options.paginate?.measurer ? {} : withMeasurer(availableFonts(template, options.pdf))),
  });
}

/** Every face this render can draw with: template-declared first, caller last. */
function availableFonts(
  template: PdfTemplate,
  pdf: PdfPaintOptions | undefined,
): { family: string; bytes: string | Uint8Array | ArrayBuffer }[] {
  const out: { family: string; bytes: string | Uint8Array | ArrayBuffer }[] = [];
  for (const font of template.resources.fonts) {
    if (font.data) out.push({ family: font.family, bytes: font.data });
  }
  for (const font of pdf?.fonts ?? []) out.push({ family: font.family, bytes: font.bytes });
  return out;
}

/** `{ measurer }` when there is anything to measure with, else nothing. */
function withMeasurer(fonts: { family: string; bytes: string | Uint8Array | ArrayBuffer }[]): {
  measurer?: TextMeasurer;
} {
  const measurer = createTemplateMeasurer(fonts);
  return measurer ? { measurer } : {};
}

/**
 * Fold the template's own `resources.fonts` into the painter's font list.
 *
 * The resource bundle exists so a template is "self-contained and portable"
 * (§4), but nothing read it: a font declared there was ignored and the text fell
 * back to a Standard-14 face, which cannot encode Persian at all. Only fonts
 * handed to `options.pdf.fonts` ever reached the document.
 *
 * Caller-supplied fonts come last so they win the family key — an application
 * with the real bytes on disk can still override what a template carries.
 */
function withTemplateFonts(
  template: PdfTemplate,
  options: PdfPaintOptions | undefined,
  diagnostics: ExpressionDiagnostic[],
): PdfPaintOptions | undefined {
  const declared: FontInput[] = [];
  for (const font of template.resources.fonts) {
    if (font.data) {
      declared.push({
        family: font.family,
        bytes: font.data,
        ...(font.weight !== undefined ? { weight: font.weight } : {}),
        ...(font.style !== undefined ? { style: font.style } : {}),
      });
    } else if (font.url) {
      diagnostics.push({
        severity: 'warning',
        message:
          `Font '${font.family}' is declared by URL, which is not fetched at render time; ` +
          `embed its bytes in the template or pass them in options.pdf.fonts`,
      });
    }
  }
  if (declared.length === 0) return options;
  return { ...options, fonts: [...declared, ...(options?.fonts ?? [])] };
}

/** Render to a real PDF (`Uint8Array`). */
export async function renderToPdf(
  template: PdfTemplate,
  input: RenderContextInput = {},
  options: RenderOptions = {},
): Promise<PdfRenderResult> {
  const doc = layoutDocument(template, input, options);
  const bytes = await paintToPdf(doc, withTemplateFonts(template, options.pdf, doc.diagnostics));
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
