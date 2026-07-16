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

export function resolvePageSize(size: PageSize, orientation: Orientation): Size {
  const base = typeof size === 'string' ? (NAMED_SIZES[size] ?? NAMED_SIZES['A4']!) : size;
  const longSide = Math.max(base.width, base.height);
  const shortSide = Math.min(base.width, base.height);
  return orientation === 'landscape'
    ? { width: longSide, height: shortSide }
    : { width: shortSide, height: longSide };
}
