/**
 * Resolves a {@link LaidOutElement}'s merged typography/box into the concrete
 * attributes both painters need, applying sensible defaults (§8A smart
 * defaults: an element with no explicit style still paints legibly). Logical
 * `start`/`end` alignment is resolved to physical `left`/`right` using the
 * element's resolved direction.
 */
import type { ResolvedDirection } from '../binding/effective-locale';
import type { Color } from '../model/color';
import type { BorderSet, Fill } from '../model/style';
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
  color: Color;
  align: PhysicalAlign;
  /** Absolute line height in points. */
  lineHeight: number;
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
    color: t.color ?? DEFAULT_COLOR,
    align: physicalAlign(t.align, el.direction),
    lineHeight: fontSize * (t.lineHeight ?? DEFAULT_LINE_HEIGHT),
  };
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
