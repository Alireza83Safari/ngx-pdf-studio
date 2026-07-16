/**
 * Node entry point — `@ngx-pdf-studio/core/node` (§3, §12). Same engine,
 * byte-identical output to the browser, plus Node conveniences: load fonts from
 * the filesystem, render to a file, and batch / mail-merge across many records
 * (§11A-E/F). The intended workflow is *design in the browser → generate at
 * scale on the server*.
 *
 * This module is the only place in `core` that touches `node:fs`; the main
 * (`.`) entry never imports it, so browser bundles never pull it in (ADR-0005).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RenderContextInput } from '../binding/render-context';
import type { FontInput } from '../paint/font-provider';
import { mergePdfs } from '../paint/merge';
import type { FontStyle, FontWeight } from '../model/style';
import type { PdfTemplate } from '../model/template';
import {
  layoutDocument,
  renderToPdf,
  renderToSvg,
  type PdfRenderResult,
  type RenderOptions,
  type SvgRenderResult,
} from '../render';

export { layoutDocument, renderToPdf, renderToSvg };
export type { PdfRenderResult, SvgRenderResult, RenderOptions };

/** Spec-named alias for the one-document render (`render({ template, data })`). */
export const render = renderToPdf;

/** Family name of the bundled Persian/Latin font (Vazirmatn, OFL). */
export const VAZIRMATN_FAMILY = 'Vazirmatn';

// The fonts ship inside the built package (dist layout) but live in the shared
// workspace folder during development (src layout); probe both (ADR-0005).
const FONT_DIR_CANDIDATES = [
  join(__dirname, '../fonts/vazirmatn'),
  join(__dirname, '../../../pdf/fonts/vazirmatn'),
];
const FONTS_DIR = FONT_DIR_CANDIDATES.find((dir) => existsSync(dir)) ?? FONT_DIR_CANDIDATES[0]!;

/**
 * Load the bundled **Vazirmatn** (OFL) Regular + Bold faces — a quality Persian
 * **and** Latin font with full glyph coverage and shaping (§11, §14A). Pass the
 * result to the render `output.fonts` / painter so Persian text embeds and
 * shapes in the PDF.
 */
export function loadBundledVazirmatn(): FontInput[] {
  return [
    {
      family: VAZIRMATN_FAMILY,
      bytes: new Uint8Array(readFileSync(join(FONTS_DIR, 'Vazirmatn-Regular.ttf'))),
    },
    {
      family: VAZIRMATN_FAMILY,
      weight: 'bold',
      bytes: new Uint8Array(readFileSync(join(FONTS_DIR, 'Vazirmatn-Bold.ttf'))),
    },
  ];
}

/** Load a font from the filesystem into a {@link FontInput} for embedding. */
export function loadFontFile(
  path: string,
  family: string,
  opts: { weight?: FontWeight; style?: FontStyle } = {},
): FontInput {
  return {
    family,
    bytes: new Uint8Array(readFileSync(path)),
    ...(opts.weight !== undefined ? { weight: opts.weight } : {}),
    ...(opts.style !== undefined ? { style: opts.style } : {}),
  };
}

/** Render and write the resulting PDF to `outPath`. */
export async function renderToFile(
  template: PdfTemplate,
  input: RenderContextInput,
  outPath: string,
  options: RenderOptions = {},
): Promise<PdfRenderResult> {
  const result = await renderToPdf(template, input, options);
  writeFileSync(outPath, result.bytes);
  return result;
}

/** Render one template across N records → N separate PDF results (mail-merge). */
export function renderBatch(
  template: PdfTemplate,
  records: RenderContextInput[],
  options: RenderOptions = {},
): Promise<PdfRenderResult[]> {
  return Promise.all(records.map((record) => renderToPdf(template, record, options)));
}

/** Render N records and concatenate them into a single merged PDF. */
export async function renderMerged(
  template: PdfTemplate,
  records: RenderContextInput[],
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const results = await renderBatch(template, records, options);
  return mergePdfs(results.map((r) => r.bytes));
}
