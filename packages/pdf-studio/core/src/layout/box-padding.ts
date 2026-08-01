/**
 * Box padding (§4): the inset between an element's bounds and its content.
 *
 * It lives here rather than next to the other paint-style resolvers because
 * padding is not a painting concern alone — it narrows the width text wraps at
 * and it grows an auto-sized box, so `layout/` needs it too, and paint may
 * import from layout but not the other way round.
 */
import type { BoxStyle } from '../model/style';
import type { EdgeInsets, Rect } from '../model/units';

export const NO_PADDING: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The padding on a (already style-merged) box, or zeros. */
export function resolvePadding(box: BoxStyle | undefined): EdgeInsets {
  const p = box?.padding;
  if (!p) return NO_PADDING;
  return {
    top: p.top || 0,
    right: p.right || 0,
    bottom: p.bottom || 0,
    left: p.left || 0,
  };
}

/**
 * The rectangle content actually occupies. Never inverts: an element padded
 * wider than itself collapses to a sliver rather than a negative box, which
 * every downstream measurement would otherwise treat as real.
 */
export function paddedRect(bounds: Rect, p: EdgeInsets): Rect {
  return {
    x: bounds.x + p.left,
    y: bounds.y + p.top,
    width: Math.max(1, bounds.width - p.left - p.right),
    height: Math.max(0, bounds.height - p.top - p.bottom),
  };
}
