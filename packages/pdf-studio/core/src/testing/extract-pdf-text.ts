/**
 * Golden-test helper: extract selectable text from a rendered PDF via pdfjs
 * (§13). Proves the PDF carries real, extractable text (not rasterized) and lets
 * tests assert content/order, including RTL. Test-only — pdfjs is a
 * devDependency and the library never imports this module.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';

/** Extract text per page; returns one joined string per page. */
export async function extractPdfText(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({
    data: bytes,
    useSystemFonts: false,
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str ?? '').join(''));
  }
  return pages;
}
