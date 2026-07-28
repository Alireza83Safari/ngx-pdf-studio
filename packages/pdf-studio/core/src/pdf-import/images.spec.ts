/**
 * Image placement on import (F4.3). The extractor used to count image XObjects
 * and throw them away with a "N image(s) skipped" warning, so a cloned format
 * lost its logo *and* the space it occupied — a hole in the layout with nothing
 * to bind. The pixels still are not decoded, but the slot now survives.
 */
import { extractPdfContent } from './extract';
import { pdfContentToTemplate } from './convert';
import type { ExtractedPage, PdfjsDocumentLike } from './types';

/** pdfjs op codes the extractor keys off (mirrors the table in extract.ts). */
const OPS = { transform: 12, save: 10, restore: 11, paintImageXObject: 85 };

/** A one-page document whose operator list paints a single image XObject. */
const docWithImage = (matrix: number[]): PdfjsDocumentLike => ({
  numPages: 1,
  getPage: async () => ({
    getViewport: () => ({ width: 595, height: 842 }),
    getTextContent: async () => ({ items: [] }),
    getOperatorList: async () => ({
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      argsArray: [[], matrix, ['img_0'], []],
    }),
  }),
});

describe('image placement (F4.3)', () => {
  it('records where an image was painted', async () => {
    // 120x60 image with its lower-left corner at (40, 700) in PDF space
    const [page] = await extractPdfContent(docWithImage([120, 0, 0, 60, 40, 700]));
    expect(page!.images).toEqual([{ x: 40, y: 700, width: 120, height: 60 }]);
  });

  it('normalises a flipped image matrix to a positive box', async () => {
    // negative scale — pdfjs emits this routinely for top-down images
    const [page] = await extractPdfContent(docWithImage([120, 0, 0, -60, 40, 760]));
    expect(page!.images).toEqual([{ x: 40, y: 700, width: 120, height: 60 }]);
  });

  it('says the pixels were not carried, rather than claiming a skip', async () => {
    const [page] = await extractPdfContent(docWithImage([120, 0, 0, 60, 40, 700]));
    expect(page!.warnings.join(' ')).toContain('without their pixels');
  });

  it('ignores a degenerate zero-area image', async () => {
    const [page] = await extractPdfContent(docWithImage([0, 0, 0, 0, 40, 700]));
    expect(page!.images).toEqual([]);
  });

  it('converts the slot into an unbound image element, flipped to top-left origin', () => {
    const page: ExtractedPage = {
      width: 595,
      height: 842,
      texts: [],
      segments: [],
      rects: [],
      images: [{ x: 40, y: 700, width: 120, height: 60 }],
      warnings: [],
    };
    const el = pdfContentToTemplate([page]).template.bands[0]!.elements.find(
      (e) => e.type === 'image',
    );
    expect(el).toBeDefined();
    // 842 - 700 - 60 = 82 from the top
    expect(el!.bounds).toEqual({ x: 40, y: 82, width: 120, height: 60 });
    if (el!.type === 'image') {
      expect(el!.fit).toBe('contain');
      // deliberately unbound: the user points it at their own asset
      expect(el!.resourceId).toBeUndefined();
      expect(el!.source).toBeUndefined();
    }
  });

  it('still converts a page that carries no images array at all', () => {
    const page: ExtractedPage = {
      width: 595,
      height: 842,
      texts: [],
      segments: [],
      rects: [],
      warnings: [],
    };
    expect(() => pdfContentToTemplate([page])).not.toThrow();
  });
});
