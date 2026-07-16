/**
 * Turns a {@link LaidChart} into neutral vector draw-ops in the element's local
 * coordinate space (top-left origin, y down). Both painters consume these ops so
 * the SVG preview and the PDF agree (§7). Kinds: column, bar, stackedColumn,
 * line (rect/line ops), area + pie/donut (filled path ops). Axis labels/legend
 * are a later step.
 */
import type { LaidChart } from '../layout/page';
import type { Rgb01 } from './color';

export type ChartOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: Rgb01 }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: Rgb01; width: number }
  | { op: 'path'; d: string; fill: Rgb01 };

const PALETTE: Rgb01[] = [
  { r: 0.15, g: 0.39, b: 0.92 },
  { r: 0.93, g: 0.28, b: 0.28 },
  { r: 0.02, g: 0.59, b: 0.41 },
  { r: 0.91, g: 0.62, b: 0.07 },
  { r: 0.55, g: 0.36, b: 0.96 },
];
const AXIS: Rgb01 = { r: 0.8, g: 0.84, b: 0.88 };
const PAD = 8;

export function chartOps(chart: LaidChart, width: number, height: number): ChartOp[] {
  if (chart.kind === 'pie' || chart.kind === 'donut') return pieOps(chart, width, height);

  const plot = {
    x: PAD,
    y: PAD,
    w: Math.max(1, width - PAD * 2),
    h: Math.max(1, height - PAD * 2),
  };
  const baselineY = plot.y + plot.h;
  const ops: ChartOp[] = [
    { op: 'line', x1: plot.x, y1: plot.y, x2: plot.x, y2: baselineY, color: AXIS, width: 0.75 },
    {
      op: 'line',
      x1: plot.x,
      y1: baselineY,
      x2: plot.x + plot.w,
      y2: baselineY,
      color: AXIS,
      width: 0.75,
    },
  ];

  const series = chart.series;
  const categories = Math.max(1, chart.categories.length);
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values.map((v) => (v > 0 ? v : 0))));

  const step = plot.w / categories;
  const yOf = (v: number): number => baselineY - (Math.max(0, v) / maxValue) * plot.h;

  if (chart.kind === 'line') {
    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length] as Rgb01;
      for (let i = 0; i + 1 < s.values.length; i++) {
        const x1 = plot.x + step * (i + 0.5);
        const x2 = plot.x + step * (i + 1.5);
        ops.push({
          op: 'line',
          x1,
          y1: yOf(s.values[i] as number),
          x2,
          y2: yOf(s.values[i + 1] as number),
          color,
          width: 1.5,
        });
      }
    });
    return ops;
  }

  if (chart.kind === 'area') {
    series.forEach((s, si) => {
      if (s.values.length === 0) return;
      const pts = s.values.map((v, i) => ({ x: plot.x + step * (i + 0.5), y: yOf(v) }));
      const first = pts[0] as { x: number; y: number };
      const lastPt = pts[pts.length - 1] as { x: number; y: number };
      const d =
        `M ${f(first.x)} ${f(baselineY)} ` +
        pts.map((p) => `L ${f(p.x)} ${f(p.y)}`).join(' ') +
        ` L ${f(lastPt.x)} ${f(baselineY)} Z`;
      ops.push({ op: 'path', d, fill: PALETTE[si % PALETTE.length] as Rgb01 });
    });
    return ops;
  }

  const horizontal = chart.kind === 'bar';
  const groupCount = categories;
  const seriesCount = Math.max(1, series.length);

  if (chart.kind === 'stackedColumn') {
    const groupW = plot.w / groupCount;
    const barW = groupW * 0.6;
    const stackTotals = Array.from({ length: groupCount }, (_, gi) =>
      series.reduce((sum, s) => sum + Math.max(0, s.values[gi] ?? 0), 0),
    );
    const stackMax = Math.max(1, ...stackTotals);
    const cursorTop = new Array<number>(groupCount).fill(baselineY);
    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length] as Rgb01;
      s.values.forEach((v, gi) => {
        const h = (Math.max(0, v) / stackMax) * plot.h;
        const top = (cursorTop[gi] ?? baselineY) - h;
        ops.push({
          op: 'rect',
          x: plot.x + groupW * gi + groupW * 0.2,
          y: top,
          w: barW,
          h,
          fill: color,
        });
        cursorTop[gi] = top;
      });
    });
    return ops;
  }

  if (horizontal) {
    const groupH = plot.h / groupCount;
    const barH = (groupH * 0.8) / seriesCount;
    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length] as Rgb01;
      s.values.forEach((v, gi) => {
        const len = (Math.max(0, v) / maxValue) * plot.w;
        const y = plot.y + groupH * gi + groupH * 0.1 + barH * si;
        ops.push({ op: 'rect', x: plot.x, y, w: len, h: barH, fill: color });
      });
    });
  } else {
    const groupW = plot.w / groupCount;
    const barW = (groupW * 0.8) / seriesCount;
    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length] as Rgb01;
      s.values.forEach((v, gi) => {
        const h = (Math.max(0, v) / maxValue) * plot.h;
        const x = plot.x + groupW * gi + groupW * 0.1 + barW * si;
        ops.push({ op: 'rect', x, y: baselineY - h, w: barW, h, fill: color });
      });
    });
  }

  return ops;
}

const TWO_PI = Math.PI * 2;
const f = (n: number): string => (Math.round(n * 100) / 100).toString();
const pointOn = (
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } => ({
  x: cx + radius * Math.cos(angle),
  y: cy + radius * Math.sin(angle),
});

/** Pie/donut slices as filled vector paths (one slice per category value). */
function pieOps(chart: LaidChart, width: number, height: number): ChartOp[] {
  const values = (chart.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - PAD;
  const ri = chart.kind === 'donut' ? r * 0.55 : 0;

  const ops: ChartOp[] = [];
  let a0 = -Math.PI / 2;
  values.forEach((v, i) => {
    if (v <= 0) return;
    const a1 = a0 + (v / total) * TWO_PI;
    ops.push({
      op: 'path',
      d: slicePath(cx, cy, r, ri, a0, a1),
      fill: PALETTE[i % PALETTE.length] as Rgb01,
    });
    a0 = a1;
  });
  return ops;
}

function slicePath(cx: number, cy: number, r: number, ri: number, a0: number, a1: number): string {
  const full = a1 - a0 >= TWO_PI - 1e-3;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = pointOn(cx, cy, r, a0);
  const o1 = pointOn(cx, cy, r, full ? a1 - 1e-3 : a1);

  if (ri <= 0) {
    if (full) {
      // A full circle needs two arcs (a single arc to the same point is undefined).
      return `M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)} Z`;
    }
    return `M ${f(cx)} ${f(cy)} L ${f(o0.x)} ${f(o0.y)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)} Z`;
  }

  const i0 = pointOn(cx, cy, ri, a0);
  const i1 = pointOn(cx, cy, ri, full ? a1 - 1e-3 : a1);
  return (
    `M ${f(o0.x)} ${f(o0.y)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)} ` +
    `L ${f(i1.x)} ${f(i1.y)} A ${f(ri)} ${f(ri)} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)} Z`
  );
}
