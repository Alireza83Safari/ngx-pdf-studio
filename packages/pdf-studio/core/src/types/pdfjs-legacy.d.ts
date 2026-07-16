/**
 * Minimal ambient declaration for the pdfjs-dist legacy CJS build, used only by
 * the golden text-extraction harness in tests (§13). pdfjs is a devDependency;
 * the library never imports it.
 */
declare module 'pdfjs-dist/legacy/build/pdf.js' {
  export const version: string;

  export interface TextItemLike {
    str?: string;
  }
  export interface AnnotationLike {
    subtype?: string;
    url?: string;
    unsafeUrl?: string;
    dest?: unknown;
    rect?: number[];
    fieldType?: string;
    fieldName?: string;
    fieldValue?: unknown;
  }
  export interface PdfPageProxy {
    getTextContent(): Promise<{ items: TextItemLike[] }>;
    getAnnotations(): Promise<AnnotationLike[]>;
  }
  export interface OutlineNode {
    title: string;
    items: OutlineNode[];
  }
  export interface PdfDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageProxy>;
    getOutline(): Promise<OutlineNode[] | null>;
    getFieldObjects(): Promise<Record<string, unknown[]> | null>;
  }
  export function getDocument(src: { data: Uint8Array; [key: string]: unknown }): {
    promise: Promise<PdfDocumentProxy>;
  };
}
