/**
 * Resolves a {@link LaidOutElement}'s merged typography/box into the concrete
 * attributes both painters need, applying sensible defaults (§8A smart
 * defaults: an element with no explicit style still paints legibly). Logical
 * `start`/`end` alignment is resolved to physical `left`/`right` using the
 * element's resolved direction.
 */
import type { ResolvedDirection } from '../binding/effective-locale';
import type { Color } from '../model/color';
import type { BorderSet, BorderSide, Fill, VerticalAlign } from '../model/style';
import type { LaidOutElement } from '../layout/page';

export const DEFAULT_FONT_SIZE = 12;
export const DEFAULT_COLOR: Color = { space: 'rgb', r: 0, g: 0, b: 0 };
export const DEFAULT_LINE_HEIGHT = 1.2;

export type PhysicalAlign = 'left' | 'right' | 'center' | 'justify';

export interface ResolvedTextStyle {
  fontFamily?: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: Color;
  align: PhysicalAlign;
  /** Where the text block sits when the box is taller than the text. */
  verticalAlign: VerticalAlign;
  /** Absolute line height in points. */
  lineHeight: number;
}

/**
 * How far down to push a block of text inside its box. Layout already grows a
 * box to at least fit its text, so this is zero unless the author made the box
 * taller on purpose — which is exactly when vertical alignment means anything.
 */
export function verticalOffset(
  style: ResolvedTextStyle,
  boxHeight: number,
  lineCount: number,
): number {
  const blockHeight = lineCount * style.lineHeight;
  const slack = boxHeight - blockHeight;
  if (slack <= 0) return 0;
  if (style.verticalAlign === 'middle') return slack / 2;
  if (style.verticalAlign === 'bottom') return slack;
  return 0;
}

export interface ResolvedBoxStyle {
  fill?: Color;
  border?: BorderSet;
  opacity: number;
  radius?: number;
}

function physicalAlign(align: string | undefined, direction: ResolvedDirection): PhysicalAlign {
  switch (align) {
    case 'left':
    case 'right':
    case 'center':
    case 'justify':
      return align;
    case 'end':
      return direction === 'rtl' ? 'left' : 'right';
    case 'start':
    default:
      return direction === 'rtl' ? 'right' : 'left';
  }
}

export function resolveTextStyle(el: LaidOutElement): ResolvedTextStyle {
  const t = el.typography ?? {};
  const fontSize = t.fontSize ?? DEFAULT_FONT_SIZE;
  const weight = t.fontWeight;
  const bold = weight === 'bold' || (typeof weight === 'number' && weight >= 600);
  return {
    ...(t.fontFamily !== undefined ? { fontFamily: t.fontFamily } : {}),
    fontSize,
    bold,
    italic: t.fontStyle === 'italic',
    underline: t.decoration === 'underline',
    strike: t.decoration === 'line-through',
    color: t.color ?? DEFAULT_COLOR,
    align: physicalAlign(t.align, el.direction),
    verticalAlign: t.verticalAlign ?? 'top',
    lineHeight: fontSize * (t.lineHeight ?? DEFAULT_LINE_HEIGHT),
  };
}

export type BoxSide = 'top' | 'right' | 'bottom' | 'left';
const BOX_SIDES: readonly BoxSide[] = ['top', 'right', 'bottom', 'left'];

export interface ResolvedBorderEdges {
  /**
   * Set when every edge is the same stroke, i.e. only `all` was given. The
   * painters then draw one stroked rectangle, which is cheaper and is the only
   * form that can carry a corner radius.
   */
  uniform?: BorderSide;
  /** Otherwise the individual edges to stroke, in top/right/bottom/left order. */
  sides: { side: BoxSide; stroke: BorderSide }[];
}

/**
 * Resolve a {@link BorderSet} to the edges to actually stroke (§5). Per the
 * model, each side falls back to `all`; a set with *only* `all` collapses to a
 * single rectangle. Before this, both painters read `all ?? top` and drew one
 * rectangle, so a border declared on just one or two sides vanished.
 */
export function resolveBorderEdges(border: BorderSet | undefined): ResolvedBorderEdges {
  if (!border) return { sides: [] };
  const overridden = BOX_SIDES.some((side) => border[side] !== undefined);
  if (!overridden) return border.all ? { uniform: border.all, sides: [] } : { sides: [] };
  const sides: { side: BoxSide; stroke: BorderSide }[] = [];
  for (const side of BOX_SIDES) {
    const stroke = border[side] ?? border.all;
    if (stroke) sides.push({ side, stroke });
  }
  return { sides };
}

/**
 * Dash pattern in points for a stroke, or `undefined` for a solid line. Scaled
 * off the stroke width so a hairline and a thick rule both read as dashed.
 */
export function dashPattern(stroke: BorderSide): number[] | undefined {
  const w = Math.max(0.5, stroke.width);
  if (stroke.style === 'dashed') return [w * 3, w * 2];
  if (stroke.style === 'dotted') return [w, w * 2];
  return undefined;
}

export function resolveBoxStyle(el: LaidOutElement): ResolvedBoxStyle {
  const b = el.box ?? {};
  const fill: Fill | undefined = b.fill;
  return {
    ...(fill ? { fill: fill.color } : {}),
    ...(b.border ? { border: b.border } : {}),
    opacity: b.opacity ?? 1,
    ...(b.border?.radius !== undefined ? { radius: b.border.radius } : {}),
  };
}
