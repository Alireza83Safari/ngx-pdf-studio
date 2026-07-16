/**
 * Resolves a declared {@link DatasetDef} to its array of rows (§9), applying
 * declarative `filter` and `sortBy` before the rows drive a repeating band
 * (§6, §11A-D). Path/expression sources reuse the expression engine; async
 * `provider` sources are recorded as unsupported here and land in Phase 5.
 */
import { Scope } from '../expression/scope';
import type { DatasetDef } from '../model/dataset';
import { evaluateExpr } from './evaluate';
import type { RenderContext } from './render-context';

const asRows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.map((v) =>
        typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : { $value: v },
      )
    : [];

/**
 * Resolve a dataset to rows. `scope` is the scope in which the dataset's source
 * path/expression is evaluated (typically the root scope, or a parent row for
 * nested datasets).
 */
export function resolveDataset(
  def: DatasetDef,
  scope: Scope,
  ctx: RenderContext,
): Record<string, unknown>[] {
  let rows: Record<string, unknown>[];

  switch (def.source.kind) {
    case 'path':
      rows = asRows(evaluateExpr(def.source.path, scope, ctx, 'latn'));
      break;
    case 'expression':
      rows = asRows(evaluateExpr(def.source.expr.source, scope, ctx, 'latn'));
      break;
    case 'provider':
      ctx.diagnostics.push({
        severity: 'warning',
        message: `Dataset provider '${def.source.provider}' is not supported in this build`,
      });
      rows = [];
      break;
  }

  if (def.filter) {
    const filterSrc = def.filter.source;
    rows = rows.filter((row) => Boolean(evaluateExpr(filterSrc, scope.child(row), ctx, 'latn')));
  }

  if (def.sortBy && def.sortBy.length > 0) {
    const keys = def.sortBy;
    // Stable sort: decorate with original index, compare by each key in turn.
    rows = rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        for (const key of keys) {
          const av = evaluateExpr(key.expr.source, scope.child(a.row), ctx, 'latn');
          const bv = evaluateExpr(key.expr.source, scope.child(b.row), ctx, 'latn');
          const cmp = compareValues(av, bv);
          if (cmp !== 0) return key.direction === 'desc' ? -cmp : cmp;
        }
        return a.index - b.index;
      })
      .map((d) => d.row);
  }

  return rows;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const as = a === null || a === undefined ? '' : String(a);
  const bs = b === null || b === undefined ? '' : String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}
