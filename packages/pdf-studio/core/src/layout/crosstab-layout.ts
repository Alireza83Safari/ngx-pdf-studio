/**
 * Lays out a {@link CrosstabElement} (§5): a pivot matrix of row groups ×
 * column groups with an aggregated measure at each intersection, plus optional
 * row/column/grand totals. MVP: the first row group, first column group, and
 * first measure (nested groups + multiple measures are a later step). Cells are
 * emitted as `staticText` laid elements (with grid borders) so the painters draw
 * them with no crosstab-specific code.
 */
import { applyFormat } from '../binding/format-value';
import {
  resolveDirection,
  resolveLocale,
  type ResolvedDirection,
} from '../binding/effective-locale';
import { evaluateExpr } from '../binding/evaluate';
import type { Scope } from '../expression/scope';
import type { Aggregate, CrosstabElement } from '../model/elements';
import type { BorderSet } from '../model/style';
import type { Rect } from '../model/units';
import type { LaidOutElement } from './page';
import type { TableLayoutDeps } from './table-layout';

const DEFAULT_ROW_HEIGHT = 18;
const GRID: BorderSet = { all: { width: 0.5, color: { space: 'rgb', r: 203, g: 213, b: 225 } } };
const HEADER_FILL = { color: { space: 'rgb', r: 241, g: 245, b: 249 } } as const;

export interface CrosstabLayout {
  elements: LaidOutElement[];
  height: number;
}

export function layoutCrosstab(
  el: CrosstabElement,
  scope: Scope,
  deps: TableLayoutDeps,
): CrosstabLayout {
  const locale = resolveLocale(deps.pageLocale, undefined, el.locale);
  const direction = resolveDirection(deps.pageDirection, locale, undefined, el.direction);
  const rowGroup = el.rowGroups[0];
  const colGroup = el.columnGroups[0];
  const measure = el.measures[0];
  if (!rowGroup || !colGroup || !measure) {
    deps.ctx.diagnostics.push({
      severity: 'warning',
      message: `Crosstab '${el.id}' needs a row group, a column group, and a measure`,
    });
    return { elements: [], height: 0 };
  }

  const rows = deps.resolveRows(el.dataset, scope);
  const keyOf = (source: string, row: Record<string, unknown>): string =>
    String(evaluateExpr(source, scope.child(row), deps.ctx, locale.digits) ?? '');
  const rowKeys = distinct(rows.map((r) => keyOf(rowGroup.source, r)));
  const colKeys = distinct(rows.map((r) => keyOf(colGroup.source, r)));

  const measureOf = (predicate: (row: Record<string, unknown>) => boolean): string => {
    const values = rows
      .filter(predicate)
      .map((r) =>
        Number(evaluateExpr(measure.value.source, scope.child(r), deps.ctx, locale.digits)),
      );
    const result = aggregate(measure.aggregate, values);
    return applyFormat(result, undefined, locale).text;
  };

  const showTotals = el.showTotals ?? false;
  const colCount = 1 + colKeys.length + (showTotals ? 1 : 0);
  const rowCount = 1 + rowKeys.length + (showTotals ? 1 : 0);
  const colW = el.bounds.width / colCount;
  const rowH = DEFAULT_ROW_HEIGHT;
  const rtl = direction === 'rtl';

  const elements: LaidOutElement[] = [];
  const push = (ci: number, ri: number, text: string, header: boolean): void => {
    const x = rtl ? el.bounds.x + el.bounds.width - (ci + 1) * colW : el.bounds.x + ci * colW;
    const bounds: Rect = { x, y: el.bounds.y + ri * rowH, width: colW, height: rowH };
    elements.push(cell(el, `c${ci}r${ri}`, text, bounds, header, direction));
  };

  // Header row: corner + column keys (+ total).
  push(0, 0, measure.label ?? '', true);
  colKeys.forEach((ck, ci) => push(ci + 1, 0, ck, true));
  if (showTotals) push(colCount - 1, 0, 'Total', true);

  // Body rows: row key + measure per column (+ row total).
  rowKeys.forEach((rk, ri) => {
    push(0, ri + 1, rk, true);
    colKeys.forEach((ck, ci) =>
      push(
        ci + 1,
        ri + 1,
        measureOf((r) => keyOf(rowGroup.source, r) === rk && keyOf(colGroup.source, r) === ck),
        false,
      ),
    );
    if (showTotals)
      push(
        colCount - 1,
        ri + 1,
        measureOf((r) => keyOf(rowGroup.source, r) === rk),
        false,
      );
  });

  // Totals row: label + column totals + grand total.
  if (showTotals) {
    const tr = rowCount - 1;
    push(0, tr, 'Total', true);
    colKeys.forEach((ck, ci) =>
      push(
        ci + 1,
        tr,
        measureOf((r) => keyOf(colGroup.source, r) === ck),
        true,
      ),
    );
    push(
      colCount - 1,
      tr,
      measureOf(() => true),
      true,
    );
  }

  return { elements, height: rowCount * rowH };
}

function distinct(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function aggregate(kind: Aggregate, values: number[]): number | null {
  const nums = values.filter((n) => Number.isFinite(n));
  if (kind === 'count') return values.length;
  if (nums.length === 0) return null;
  switch (kind) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
  }
}

function cell(
  el: CrosstabElement,
  key: string,
  text: string,
  bounds: Rect,
  header: boolean,
  direction: ResolvedDirection,
): LaidOutElement {
  return {
    id: `${el.id}:${key}`,
    type: 'staticText',
    bounds,
    rotation: 0,
    zIndex: el.zIndex,
    direction,
    text,
    typography: { fontSize: 11, ...(header ? { fontWeight: 'bold' as const } : {}) },
    box: header ? { fill: HEADER_FILL, border: GRID } : { border: GRID },
    source: el,
  };
}
