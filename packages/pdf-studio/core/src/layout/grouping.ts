/**
 * Builds the flow of bands for a grouped detail dataset (§6, §11A-D):
 * multi-level groupHeader / detail / groupFooter, emitting a header when a group
 * key changes and a footer when it ends. Group rows are exposed to the
 * header/footer scopes as `$group` (an array) plus `$groupIndex`/`$groupKey`, so
 * a footer field can compute a group aggregate, e.g. `sum($group, amount)`.
 *
 * Grouping is over **consecutive** equal keys (JasperReports semantics): sort
 * the dataset by the group key(s) first (a dataset `sortBy`, §9) for correct
 * grouping.
 */
import { evaluateExpr } from '../binding/evaluate';
import type { RenderContext } from '../binding/render-context';
import { Scope, type BuiltinVars } from '../expression/scope';
import type { Band } from '../model/band';

export interface FlowItem {
  band: Band;
  scope: Scope;
}

export interface GroupingInput {
  detail: Band;
  rows: Record<string, unknown>[];
  /** Group headers ordered by ascending `groupLevel` (outermost first). */
  groupHeaders: Band[];
  groupFooters: Band[];
  rootScope: Scope;
  ctx: RenderContext;
  digits: 'latn' | 'persian';
  /** Per-row report-variable snapshots, keyed by row reference (§11A-D). */
  varsByRow?: Map<Record<string, unknown>, Record<string, unknown>>;
}

const varsOf = (input: GroupingInput, row: Record<string, unknown>): Record<string, unknown> =>
  input.varsByRow?.get(row) ?? {};

export function buildGroupedFlow(input: GroupingInput): FlowItem[] {
  const headers = input.groupHeaders
    .slice()
    .sort((a, b) => (a.groupLevel ?? 0) - (b.groupLevel ?? 0));
  const out: FlowItem[] = [];
  emitLevel(input.rows, 0, headers, input, out);
  return out;
}

function emitLevel(
  rows: Record<string, unknown>[],
  level: number,
  headers: Band[],
  input: GroupingInput,
  out: FlowItem[],
): void {
  const header = headers[level];
  if (!header || !header.groupKey) {
    emitDetail(rows, input, out);
    return;
  }
  const keyExpr = header.groupKey.source;
  const groups = partition(rows, (row) =>
    String(evaluateExpr(keyExpr, input.rootScope.child(row), input.ctx, input.digits) ?? ''),
  );

  const footer = input.groupFooters.find(
    (f) => (f.groupLevel ?? 0) === (header.groupLevel ?? level),
  );

  groups.forEach((group, groupIndex) => {
    const builtins: BuiltinVars = {
      $group: group.rows,
      $groupIndex: groupIndex,
      $groupKey: group.key,
    };
    const firstRow = group.rows[0] ?? {};
    const lastRow = group.rows[group.rows.length - 1] ?? {};
    const headerScope = input.rootScope.child(firstRow, {
      ...builtins,
      $vars: varsOf(input, firstRow),
    });
    out.push({ band: header, scope: headerScope });
    emitLevel(group.rows, level + 1, headers, input, out);
    // The footer sees the variable values as of the group's last row (subtotals).
    if (footer) {
      const footerScope = input.rootScope.child(lastRow, {
        ...builtins,
        $vars: varsOf(input, lastRow),
      });
      out.push({ band: footer, scope: footerScope });
    }
  });
}

function emitDetail(rows: Record<string, unknown>[], input: GroupingInput, out: FlowItem[]): void {
  rows.forEach((row, index) => {
    const builtins: BuiltinVars = {
      $index: index,
      $first: index === 0,
      $last: index === rows.length - 1,
      $vars: varsOf(input, row),
    };
    out.push({ band: input.detail, scope: input.rootScope.child(row, builtins) });
  });
}

/** Split into runs of consecutive equal key. */
function partition(
  rows: Record<string, unknown>[],
  keyOf: (row: Record<string, unknown>) => string,
): { key: string; rows: Record<string, unknown>[] }[] {
  const runs: { key: string; rows: Record<string, unknown>[] }[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else runs.push({ key, rows: [row] });
  }
  return runs;
}
