/**
 * Reverse import (ROADMAP ۵.۱): PDF → editable template. Feed it a document
 * from *your* pdfjs (`getDocument(bytes).promise`) — core talks to it purely
 * structurally, so pdfjs stays out of the library's dependency tree.
 */
export {
  pdfContentToTemplate,
  type PdfImportOptions,
  type PdfImportResult,
} from './convert';
export { extractPdfContent } from './extract';
export {
  classifyPage,
  detectValueKind,
  looksLikeLabel,
  keyFromLabel,
  type PageClassification,
  type TextClassification,
  type TableRegion,
  type DetectedColumn,
  type TextRole,
  type ValueKind,
} from './classify';
export {
  classifyPageWithAi,
  CLASSIFY_CONTRACT,
  type AiClassifyOptions,
} from './classify-ai';
export type {
  ExtractedPage,
  ExtractedRect,
  ExtractedSegment,
  ExtractedText,
  PdfjsDocumentLike,
  PdfjsPageLike,
} from './types';

import { pdfContentToTemplate, type PdfImportOptions, type PdfImportResult } from './convert';
import { extractPdfContent } from './extract';
import type { PdfjsDocumentLike } from './types';

/** One-call convenience: extract a pdfjs document and convert it. */
export async function importPdfDocument(
  doc: PdfjsDocumentLike,
  options: PdfImportOptions = {},
): Promise<PdfImportResult> {
  return pdfContentToTemplate(await extractPdfContent(doc), options);
}
