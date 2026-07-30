/**
 * Resolves a {@link PageSize} + orientation to concrete point dimensions (§4).
 * Named sizes are defined portrait-first; orientation normalizes which side is
 * longer. 1 inch = 72 pt.
 */
import type { Orientation, PageSize } from '../model/page';
import type { Size } from '../model/units';

/** Named page sizes in points, portrait orientation. */
const NAMED_SIZES: Record<string, Size> = {
  A3: { width: 841.89, height: 1190.55 },
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
};

/**
 * Why a page size is unusable, or `null` when it is fine. Kept next to the
 * resolver so the fallback rule and the message can never disagree.
 *
 * The model types `size` as a name **or** a `Size`, and nothing stopped an
 * unknown name or a negative dimension from arriving: both used to resolve in
 * silence — an unknown name to A4, and `{width: -10}` to a page with negative
 * extent that every downstream measurement then treated as real (§9).
 */
export function pageSizeProblem(size: PageSize): string | null {
  if (typeof size === 'string') {
    return NAMED_SIZES[size] ? null : `Unknown page size '${size}'`;
  }
  const bad = (v: number) => !Number.isFinite(v) || v <= 0;
  if (bad(size.width) || bad(size.height)) {
    return `Page size ${size.width}×${size.height}pt is not a positive area`;
  }
  return null;
}

export function resolvePageSize(size: PageSize, orientation: Orientation): Size {
  // One fallback for every invalid input, not just unknown names: A4 keeps the
  // document renderable and printable, where clamping a negative extent to a
  // hair-thin page would only move the confusion downstream.
  const base = pageSizeProblem(size)
    ? NAMED_SIZES['A4']!
    : typeof size === 'string'
      ? NAMED_SIZES[size]!
      : size;
  const longSide = Math.max(base.width, base.height);
  const shortSide = Math.min(base.width, base.height);
  return orientation === 'landscape'
    ? { width: longSide, height: shortSide }
    : { width: shortSide, height: longSide };
}
