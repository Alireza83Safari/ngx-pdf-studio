/**
 * Geometry primitives. The canonical internal unit is the **point** (pt);
 * millimetres/pixels are UI conveniences converted at the edges (§4).
 */

/** A length expressed in the document's canonical unit (points). */
export type Pt = number;

/** Display units exposed in the UI; internal storage is always `pt`. */
export type LengthUnit = 'pt' | 'mm';

export interface Size {
  width: Pt;
  height: Pt;
}

export interface Point {
  x: Pt;
  y: Pt;
}

/** A band-relative bounding box (§5). */
export interface Rect {
  x: Pt;
  y: Pt;
  width: Pt;
  height: Pt;
}

export interface EdgeInsets {
  top: Pt;
  right: Pt;
  bottom: Pt;
  left: Pt;
}

/** 1 inch = 72 pt = 25.4 mm. */
export const POINTS_PER_MM = 72 / 25.4;

export const mmToPt = (mm: number): Pt => mm * POINTS_PER_MM;
export const ptToMm = (pt: Pt): number => pt / POINTS_PER_MM;
