/**
 * Color conversion for the painters. RGB is canonical for preview; CMYK and
 * spot colors are approximated to RGB for preview/standard-PDF output here, with
 * the accurate device-CMYK / spot PDF path arriving in Phase 5C (§11A-B). All
 * conversions are deterministic.
 */
import type { Color } from '../model/color';

export interface Rgb01 {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Convert any {@link Color} to normalized 0–1 RGB (CMYK/spot approximated). */
export function colorToRgb01(color: Color): Rgb01 {
  switch (color.space) {
    case 'rgb':
      return { r: clamp01(color.r / 255), g: clamp01(color.g / 255), b: clamp01(color.b / 255) };
    case 'cmyk':
      return {
        r: clamp01((1 - color.c) * (1 - color.k)),
        g: clamp01((1 - color.m) * (1 - color.k)),
        b: clamp01((1 - color.y) * (1 - color.k)),
      };
    case 'spot':
      return colorToRgb01(color.approximation);
  }
}

/** Alpha channel (0–1) for a color; defaults to opaque. */
export function colorAlpha(color: Color): number {
  return color.space === 'spot' ? (color.approximation.a ?? 1) : (color.a ?? 1);
}

/** CSS color string (for the SVG preview painter). */
export function colorToCss(color: Color): string {
  const { r, g, b } = colorToRgb01(color);
  const to255 = (n: number): number => Math.round(n * 255);
  const a = colorAlpha(color);
  return a < 1
    ? `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${a})`
    : `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}
