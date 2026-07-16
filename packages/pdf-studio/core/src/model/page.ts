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
}
