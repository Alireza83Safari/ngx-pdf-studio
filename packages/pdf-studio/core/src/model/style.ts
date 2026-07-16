/**
 * Reusable, named styles plus the inline style primitives elements use.
 * Resolution order (documented, cascading): element-inline → named style
 * (`styleId`) → band defaults → page defaults (§4). A `NamedStyle` is globally
 * editable: change it once, every element referencing it updates (§8A-B).
 */
import type { Color } from './color';
import type { Expression } from './expression';
import type { Pt } from './units';

export type FontWeight = 'normal' | 'bold' | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type FontStyle = 'normal' | 'italic';
export type HorizontalAlign = 'start' | 'center' | 'end' | 'left' | 'right' | 'justify';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type TextDecoration = 'none' | 'underline' | 'line-through';

export interface Typography {
  /** Font family id, resolved against the resource bundle / registered fonts. */
  fontFamily?: string;
  fontSize?: Pt;
  fontWeight?: FontWeight;
  fontStyle?: FontStyle;
  /** Multiplier of font size (e.g. 1.4) — leading. */
  lineHeight?: number;
  letterSpacing?: Pt;
  color?: Color;
  align?: HorizontalAlign;
  verticalAlign?: VerticalAlign;
  decoration?: TextDecoration;
  /** OpenType features, e.g. `{ tnum: true, liga: false }` (§11A-C). */
  fontFeatures?: Record<string, boolean>;
}

export type BorderStyle = 'solid' | 'dashed' | 'dotted';

export interface BorderSide {
  width: Pt;
  color: Color;
  style?: BorderStyle;
}

/** Per-side borders; `all` is a convenience applied where a side is absent. */
export interface BorderSet {
  all?: BorderSide;
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
  /** Corner radius for rectangular fills/borders. */
  radius?: Pt;
}

export interface Fill {
  color: Color;
}

export interface BoxStyle {
  fill?: Fill;
  border?: BorderSet;
  /** Inner padding. */
  padding?: { top: Pt; right: Pt; bottom: Pt; left: Pt };
  /** 0–1; multiplies element alpha. */
  opacity?: number;
}

/** A reusable style referenced by `ElementBase.styleId`. */
export interface NamedStyle {
  id: string;
  name: string;
  typography?: Typography;
  box?: BoxStyle;
}

/**
 * Conditional (data-driven) styling (§11A-D): when `when` evaluates truthy in
 * the element's scope, its typography/box overlay the element's resolved style.
 * Multiple entries apply in order (later wins) — e.g. negative numbers red,
 * overdue rows highlighted.
 */
export interface ConditionalStyle {
  when: Expression;
  typography?: Typography;
  box?: BoxStyle;
}
