/** Painters: shared style resolution, SVG preview, and PDF output (§7, §10). */
export { colorToRgb01, colorToCss, colorAlpha, type Rgb01 } from './color';
export {
  resolveTextStyle,
  resolveBoxStyle,
  type ResolvedTextStyle,
  type ResolvedBoxStyle,
  type PhysicalAlign,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
} from './paint-style';
export { paintToSvg, paintPageToSvg } from './svg-painter';
export { paintToPdf, type PdfPaintOptions } from './pdf-painter';
export { FontProvider, type FontInput, type FontQuery } from './font-provider';
export { mergePdfs } from './merge';
