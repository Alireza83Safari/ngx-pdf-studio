/**
 * Resolves a {@link ChartElement} to a {@link LaidChart} (§5): evaluates the
 * category labels and each series' values across the bound dataset rows, in the
 * row scope. The painters then draw it as vector primitives.
 */
import { evaluateExpr } from '../binding/evaluate';
import type { RenderContext } from '../binding/render-context';
import type { Scope } from '../expression/scope';
import type { ChartElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { LaidChart } from './page';

interface Deps {
  ctx: RenderContext;
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[];
}

export function resolveChart(
  el: ChartElement,
  scope: Scope,
  locale: LocaleSetup,
  deps: Deps,
): LaidChart {
  const rows = deps.resolveRows(el.dataset, scope);
  const digits = locale.digits;

  const categories = rows.map((row, index) => {
    if (!el.categories) return String(index + 1);
    const value = evaluateExpr(
      el.categories.source,
      scope.child(row, { $index: index }),
      deps.ctx,
      digits,
    );
    return value == null ? '' : String(value);
  });

  const series = el.series.map((s) => ({
    ...(s.name !== undefined ? { name: s.name } : {}),
    ...(s.kind !== undefined ? { kind: s.kind } : {}),
    values: rows.map((row, index) => {
      const value = evaluateExpr(
        s.values.source,
        scope.child(row, { $index: index }),
        deps.ctx,
        digits,
      );
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    }),
  }));

  return { kind: el.chartKind, categories, series, showLegend: el.showLegend ?? false };
}
