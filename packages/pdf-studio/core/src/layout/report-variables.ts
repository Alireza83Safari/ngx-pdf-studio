/**
 * Computes per-row snapshots of report variables (§11A-D). Walking the detail
 * rows in dataset order, each variable accumulates and resets at its boundary;
 * the inclusive running value at every row is recorded. The result is keyed by
 * row **object reference**, so the same snapshot is found again no matter how
 * the grouping flow later re-partitions the rows.
 *
 * `page` reset is not yet supported (page boundaries are unknown until packing);
 * such variables fall back to `report` scope with a non-fatal diagnostic (§9).
 */
import { evaluateExpr } from '../binding/evaluate';
import type { RenderContext } from '../binding/render-context';
import type { Scope } from '../expression/scope';
import type { Band } from '../model/band';
import type { VariableDef } from '../model/variable';

type Row = Record<string, unknown>;

export function computeRowVariables(
  defs: VariableDef[],
  rows: Row[],
  groupHeaders: Band[],
  rootScope: Scope,
  ctx: RenderContext,
  digits: 'latn' | 'persian',
): Map<Row, Record<string, unknown>> {
  const byRow = new Map<Row, Record<string, unknown>>();
  for (const row of rows) byRow.set(row, {});
  if (defs.length === 0) return byRow;

  const sortedHeaders = groupHeaders
    .slice()
    .sort((a, b) => (a.groupLevel ?? 0) - (b.groupLevel ?? 0));

  for (const def of defs) {
    if (def.reset === 'page') {
      ctx.diagnostics.push({
        severity: 'warning',
        message: `Variable '${def.name}' uses reset 'page', which is not supported yet; treated as 'report'`,
      });
    }
    const resetHeader = def.reset === 'group' ? sortedHeaders[def.resetGroupLevel ?? 0] : undefined;

    let prevKey: string | null = null;
    let count = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let firstVal: unknown;
    let lastVal: unknown;

    for (const row of rows) {
      const key = resetHeader?.groupKey
        ? String(evaluateExpr(resetHeader.groupKey.source, rootScope.child(row), ctx, digits) ?? '')
        : '__report__';
      if (key !== prevKey) {
        count = 0;
        sum = 0;
        min = Number.POSITIVE_INFINITY;
        max = Number.NEGATIVE_INFINITY;
        firstVal = undefined;
        lastVal = undefined;
      }
      prevKey = key;

      const raw = evaluateExpr(def.expression.source, rootScope.child(row), ctx, digits);
      const num = Number(raw);
      count += 1;
      if (Number.isFinite(num)) {
        sum += num;
        min = Math.min(min, num);
        max = Math.max(max, num);
      }
      if (firstVal === undefined) firstVal = raw;
      lastVal = raw;

      (byRow.get(row) as Record<string, unknown>)[def.name] = snapshot(def.calculation, {
        count,
        sum,
        min,
        max,
        firstVal,
        lastVal,
      });
    }
  }
  return byRow;
}

function snapshot(
  calc: VariableDef['calculation'],
  s: { count: number; sum: number; min: number; max: number; firstVal: unknown; lastVal: unknown },
): unknown {
  switch (calc) {
    case 'sum':
      return s.sum;
    case 'count':
      return s.count;
    case 'avg':
      return s.count > 0 ? s.sum / s.count : 0;
    case 'min':
      return Number.isFinite(s.min) ? s.min : null;
    case 'max':
      return Number.isFinite(s.max) ? s.max : null;
    case 'first':
      return s.firstVal ?? null;
    case 'last':
      return s.lastVal ?? null;
  }
}
