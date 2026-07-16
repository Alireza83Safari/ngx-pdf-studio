/**
 * Color model. RGB is the canonical browser/preview space; CMYK and spot
 * colors exist for print production (§11A-B) — the preview approximates them,
 * the PDF painter resolves them accurately. A `Color` is a tagged union so the
 * painter can branch on the color space without guessing.
 */

/** sRGB color. Components are 0–255; `a` (alpha) is 0–1, default 1. */
export interface RgbColor {
  space: 'rgb';
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** Device CMYK. Components are 0–1. */
export interface CmykColor {
  space: 'cmyk';
  c: number;
  m: number;
  y: number;
  k: number;
  a?: number;
}

/** Named spot/Pantone color with an RGB approximation for preview. */
export interface SpotColor {
  space: 'spot';
  name: string;
  /** Tint 0–1. */
  tint?: number;
  /** Fallback used by the preview painter (the PDF carries the spot). */
  approximation: RgbColor;
}

export type Color = RgbColor | CmykColor | SpotColor;

/** Convenience constructor for an opaque sRGB color. */
export const rgb = (r: number, g: number, b: number, a?: number): RgbColor =>
  a === undefined ? { space: 'rgb', r, g, b } : { space: 'rgb', r, g, b, a };
