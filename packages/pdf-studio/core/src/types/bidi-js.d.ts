/**
 * Minimal ambient declaration for `bidi-js` (which ships no types), covering the
 * subset of the UAX #9 API this engine uses (ADR-0003).
 */
declare module 'bidi-js' {
  export interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }

  export interface Bidi {
    getEmbeddingLevels(text: string, baseDirection?: 'ltr' | 'rtl' | 'auto'): EmbeddingLevels;
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): Array<[number, number]>;
    getReorderedString(text: string, embeddingLevels: EmbeddingLevels): string;
    getReorderedIndices(text: string, embeddingLevels: EmbeddingLevels): number[];
  }

  export default function bidiFactory(): Bidi;
}
