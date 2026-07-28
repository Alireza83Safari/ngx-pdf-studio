/**
 * Resolves a {@link ChartElement} to a {@link LaidChart} (§5): evaluates the
 * category labels and each series' values across the bound dataset rows, in the
 * row scope. The painters then draw it as vector primitives.
 */
import type { ResolvedDirection } from '../binding/effective-locale';
import { evaluateExpr } from '../binding/evaluate';
import type { RenderContext } from '../binding/render-context';
import type { Scope } from '../expression/scope';
import type { ChartElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { TextMeasurer } from './measure';
import type { LaidChart } from './page';

/**
 * Font size of every chart label (axis, category, legend). It lives here rather
 * than in the painter because the widths are *measured* at layout time — the
 * painters have no font metrics.
 */
export const CHART_LABEL_SIZE = 7.5;

interface Deps {
  ctx: RenderContext;
  measurer: TextMeasurer;
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[];
}

export function resolveChart(
  el: ChartElement,
  scope: Scope,
  locale: LocaleSetup,
  deps: Deps,
  direction: ResolvedDirection,
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

  const widthOf = (text: string): number =>
    deps.measurer.measure(text, { fontSize: CHART_LABEL_SIZE }).width;

  return {
    kind: el.chartKind,
    categories,
    series,
    showLegend: el.showLegend ?? false,
    showLabels: el.showLabels ?? false,
    rtl: direction === 'rtl',
    digits,
    seriesNameWidths: series.map((s) => (s.name ? widthOf(s.name) : 0)),
    categoryWidths: categories.map(widthOf),
  };
}
