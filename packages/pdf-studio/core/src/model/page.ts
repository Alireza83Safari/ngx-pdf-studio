/**
 * Page setup (§4). The canonical internal unit is points; `unit` is a UI display
 * convenience only. Direction/locale here are document defaults, overridable per
 * band/element.
 */
import type { Direction, LocaleSetup } from './locale';
import type { EdgeInsets, LengthUnit, Size } from './units';

export type NamedPageSize = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal';

export type PageSize = NamedPageSize | Size;

export type Orientation = 'portrait' | 'landscape';

export interface ColumnSetup {
  count: number;
  gap: number;
}

export interface PageSetup {
  size: PageSize;
  orientation: Orientation;
  margins: EdgeInsets;
  columns?: ColumnSetup;
  /** Document default; overridable per band/element (incl. `'auto'`). */
  direction: Direction;
  /** Document-default language/digits/calendar. */
  locale: LocaleSetup;
  /** UI display unit; internal storage is always points. */
  unit: LengthUnit;
  /**
   * How `bounds.x` on this page's elements is authored (§7).
   *
   * - `physical` (default) — x=0 is the left paper edge, whatever `direction`
   *   is. Back-compatible: every template written before this flag existed.
   * - `logical` — x=0 is the **start** edge, so a right-to-left page is
   *   authored the way it reads (title first, label before value) and is
   *   mirrored to physical before layout.
   *
   * On an LTR page the two are identical, so the flag is safe to set
   * unconditionally. The convention is per page, not per band: a band's own
   * `direction` override affects text, not the coordinate system.
   */
  coordinates?: 'physical' | 'logical';
}
