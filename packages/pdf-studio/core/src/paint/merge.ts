/**
 * Document assembly: concatenate several rendered PDFs into one (§11A-E,
 * mail-merge / document assembly). Pure pdf-lib, so it runs in the browser and
 * Node alike; metadata is fixed for deterministic output (§3).
 */
import { PDFDocument } from 'pdf-lib';

const EPOCH = new Date(0);

/** Merge rendered PDF byte arrays into a single PDF, preserving page order. */
export async function mergePdfs(documents: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  merged.setProducer('ngx-pdf-studio');
  merged.setCreator('ngx-pdf-studio');
  merged.setCreationDate(EPOCH);
  merged.setModificationDate(EPOCH);

  for (const bytes of documents) {
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  return merged.save();
}
