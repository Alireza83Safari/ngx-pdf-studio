/**
 * Bands are the ordered sections the pagination engine flows across pages (§6).
 * Each band has a fixed or auto-grow height and holds positioned elements.
 */
import type { AnyElement } from './elements';
import type { Expression } from './expression';
import type { Direction, LocaleSetup } from './locale';
import type { Pt } from './units';

export type BandType =
  | 'background'
  | 'watermark'
  | 'reportHeader'
  | 'pageHeader'
  | 'columnHeader'
  | 'groupHeader'
  | 'detail'
  | 'groupFooter'
  | 'columnFooter'
  | 'pageFooter'
  | 'reportFooter';

export type BandHeight = { mode: 'fixed'; value: Pt } | { mode: 'auto'; min?: Pt; max?: Pt };

export interface Band {
  id: string;
  type: BandType;
  height: BandHeight;
  elements: AnyElement[];

  /** For `detail` and group bands: the dataset/array this band iterates. */
  dataset?: string;
  /** For `groupHeader`/`groupFooter`: the group key expression. */
  groupKey?: Expression;
  /** Multi-level grouping order; 0 is outermost. */
  groupLevel?: number;

  direction?: Direction;
  locale?: Partial<LocaleSetup>;

  /** Pagination controls (§6). */
  keepTogether?: boolean;
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
  /** A `detail` band that overflows continues under the repeated page header. */
  canSplit?: boolean;
  /**
   * Master-page scope for `pageHeader`/`pageFooter` bands (§11A-E): which pages
   * this band applies to. Multiple page headers/footers can coexist; the most
   * specific applicable one wins per page (`first` > `odd`/`even` > `all`).
   * Defaults to `all`.
   */
  master?: 'all' | 'first' | 'odd' | 'even';

  visibleWhen?: Expression;
  printWhen?: Expression;
}
