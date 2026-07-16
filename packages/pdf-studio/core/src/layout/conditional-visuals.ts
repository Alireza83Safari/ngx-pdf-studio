/**
 * Value-driven visual helpers for conditional formatting (§11A-D): data-bar
 * fractions and color-scale interpolation. Pure functions, shared by layout so
 * both painters consume the resolved result.
 */
import type { Color, RgbColor } from '../model/color';
import type { IconName, IconSet } from '../model/element-base';
import type { Rect } from '../model/units';

const BLACK: Color = { space: 'rgb', r: 0, g: 0, b: 0 };

/** Square box for an icon at the element's start edge, vertically centered. */
export function iconBox(
  bounds: Rect,
  direction: 'ltr' | 'rtl',
): { x: number; y: number; size: number } {
  const size = Math.min(bounds.height * 0.8, 14);
  const pad = 2;
  const x = direction === 'rtl' ? bounds.x + bounds.width - pad - size : bounds.x + pad;
  const y = bounds.y + (bounds.height - size) / 2;
  return { x, y, size };
}

/** The three corner points of a triangle icon within its box. */
export function iconTrianglePoints(
  box: { x: number; y: number; size: number },
  up: boolean,
): Array<[number, number]> {
  const { x, y, size } = box;
  return up
    ? [
        [x + size / 2, y],
        [x + size, y + size],
        [x, y + size],
      ]
    : [
        [x, y],
        [x + size, y],
        [x + size / 2, y + size],
      ];
}

/** Pick the icon for `value`: the highest threshold `at` ≤ value (or the lowest). */
export function pickIcon(set: IconSet, value: number): { name: IconName; color: Color } {
  const sorted = [...set.thresholds].sort((a, b) => a.at - b.at);
  let chosen = sorted[0];
  for (const t of sorted) {
    if (value >= t.at) chosen = t;
  }
  if (!chosen) return { name: 'circle', color: BLACK };
  return { name: chosen.icon, color: chosen.color ?? BLACK };
}

/** Clamp `(value − min) / (max − min)` to the unit interval. */
export function dataBarFraction(value: number, max: number, min = 0): number {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, (value - min) / span));
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const channel = (a: number, b: number, t: number): number => Math.round(lerp(a, b, t));

/** Interpolate an sRGB color across `stops` at position `value`. */
export function colorScaleColor(
  stops: ReadonlyArray<{ at: number; color: RgbColor }>,
  value: number,
): RgbColor {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return { space: 'rgb', r: 0, g: 0, b: 0 };
  if (value <= first.at) return first.color;
  if (value >= last.at) return last.color;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i] as { at: number; color: RgbColor };
    const hi = sorted[i + 1] as { at: number; color: RgbColor };
    if (value >= lo.at && value <= hi.at) {
      const t = hi.at === lo.at ? 0 : (value - lo.at) / (hi.at - lo.at);
      return {
        space: 'rgb',
        r: channel(lo.color.r, hi.color.r, t),
        g: channel(lo.color.g, hi.color.g, t),
        b: channel(lo.color.b, hi.color.b, t),
      };
    }
  }
  return last.color;
}
