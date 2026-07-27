/**
 * Turns a {@link LaidChart} into neutral vector draw-ops in the element's local
 * coordinate space (top-left origin, y down). Both painters consume these ops so
 * the SVG preview and the PDF agree (§7). Kinds: column, bar, stackedColumn,
 * line (rect/line ops), area + pie/donut (filled path ops). Axis labels/legend
 * are a later step.
 */
import { CHART_LABEL_SIZE } from '../layout/chart-resolve';
import type { LaidChart, VectorOp } from '../layout/page';
import type { Rgb01 } from './color';

/** Chart draw-ops are the shared neutral vector ops (incl. `text`, §7). */
export type ChartOp = VectorOp;

const PALETTE: Rgb01[] = [
  { r: 0.15, g: 0.39, b: 0.92 },
  { r: 0.93, g: 0.28, b: 0.28 },
  { r: 0.02, g: 0.59, b: 0.41 },
  { r: 0.91, g: 0.62, b: 0.07 },
  { r: 0.55, g: 0.36, b: 0.96 },
];
const AXIS: Rgb01 = { r: 0.8, g: 0.84, b: 0.88 };
const LABEL: Rgb01 = { r: 0.42, g: 0.45, b: 0.5 };
const PAD = 8;
const LABEL_SIZE = CHART_LABEL_SIZE;
const LEGEND_H = 12;
const AXIS_LABEL_H = 11;
const SWATCH = 7;
const SWATCH_GAP = 3;
const ENTRY_GAP = 12;

/**
 * Width of a chart label. `resolveChart` measures these with the document's real
 * font; the character-count fallback only applies to a hand-built `LaidChart`
 * (it is Latin-calibrated and badly underestimates Persian).
 */
function labelWidth(text: string, measured: number | undefined): number {
  return measured !== undefined && measured > 0 ? measured : text.length * LABEL_SIZE * 0.62;
}

/**
 * Legend row: one swatch + name per series. Entries run in the reading
 * direction, so on an RTL page the first series sits at the right.
 */
function legendOps(
  names: string[],
  widths: number[] | undefined,
  x: number,
  y: number,
  rtl: boolean,
  right: number,
): ChartOp[] {
  const ops: ChartOp[] = [];
  let cursor = rtl ? right : x;
  names.forEach((name, i) => {
    const w = labelWidth(name, widths?.[i]);
    const entry = SWATCH + SWATCH_GAP + w;
    const start = rtl ? cursor - entry : cursor;
    ops.push({
      op: 'rect',
      x: rtl ? start + SWATCH_GAP + w : start,
      y,
      w: SWATCH,
      h: SWATCH,
      fill: PALETTE[i % PALETTE.length] as Rgb01,
    });
    ops.push({
      op: 'text',
      x: rtl ? start + w : start + SWATCH + SWATCH_GAP,
      y: y + 6.5,
      text: name,
      size: LABEL_SIZE,
      color: LABEL,
      ...(rtl ? { align: 'end' as const } : {}),
    });
    cursor = rtl ? cursor - entry - ENTRY_GAP : cursor + entry + ENTRY_GAP;
  });
  return ops;
}

/** Geometry shared by every cartesian series renderer. */
interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Category-slot centre, the anchor line/area/scatter series hang off. */
const centreOf = (plot: Plot, step: number, i: number): number => plot.x + step * (i + 0.5);

/**
 * Which physical slot a category index occupies. On an RTL page the first
 * category belongs at the right, so the whole series reads right-to-left.
 */
const slotOf = (i: number, count: number, rtl: boolean): number => (rtl ? count - 1 - i : i);

/** Maps a category index to its physical slot for one chart. */
type ToSlot = (i: number) => number;

function lineSeriesOps(
  values: number[],
  color: Rgb01,
  plot: Plot,
  step: number,
  yOf: (v: number) => number,
  toSlot: ToSlot,
): ChartOp[] {
  const ops: ChartOp[] = [];
  for (let i = 0; i + 1 < values.length; i++) {
    ops.push({
      op: 'line',
      x1: centreOf(plot, step, toSlot(i)),
      y1: yOf(values[i] as number),
      x2: centreOf(plot, step, toSlot(i + 1)),
      y2: yOf(values[i + 1] as number),
      color,
      width: 1.5,
    });
  }
  return ops;
}

function areaSeriesOps(
  values: number[],
  color: Rgb01,
  plot: Plot,
  step: number,
  yOf: (v: number) => number,
  baselineY: number,
  toSlot: ToSlot,
): ChartOp[] {
  if (values.length === 0) return [];
  const pts = values.map((v, i) => ({ x: centreOf(plot, step, toSlot(i)), y: yOf(v) }));
  pts.sort((a, b) => a.x - b.x);
  const first = pts[0] as { x: number; y: number };
  const lastPt = pts[pts.length - 1] as { x: number; y: number };
  const d =
    `M ${f(first.x)} ${f(baselineY)} ` +
    pts.map((p) => `L ${f(p.x)} ${f(p.y)}`).join(' ') +
    ` L ${f(lastPt.x)} ${f(baselineY)} Z`;
  return [{ op: 'path', d, fill: color }];
}

/** Scatter marks: a small square per point (rect keeps both painters identical). */
function scatterSeriesOps(
  values: number[],
  color: Rgb01,
  plot: Plot,
  step: number,
  yOf: (v: number) => number,
  toSlot: ToSlot,
): ChartOp[] {
  const s = 3.5;
  return values.map((v, i) => ({
    op: 'rect' as const,
    x: centreOf(plot, step, toSlot(i)) - s / 2,
    y: yOf(v) - s / 2,
    w: s,
    h: s,
    fill: color,
  }));
}

/** One series of a grouped column chart, in slot `slot` of `slots`. */
function columnSeriesOps(
  values: number[],
  color: Rgb01,
  plot: Plot,
  groupW: number,
  slot: number,
  slots: number,
  baselineY: number,
  yOf: (v: number) => number,
  toSlot: ToSlot,
): ChartOp[] {
  const barW = (groupW * 0.8) / Math.max(1, slots);
  return values.map((v, gi) => {
    const top = yOf(v);
    return {
      op: 'rect' as const,
      x: plot.x + groupW * toSlot(gi) + groupW * 0.1 + barW * slot,
      y: top,
      w: barW,
      h: baselineY - top,
      fill: color,
    };
  });
}

/** Bare trend line: no axes, no labels, no legend — it fills its whole box (§5). */
function sparklineOps(chart: LaidChart, width: number, height: number): ChartOp[] {
  const plot: Plot = { x: 1, y: 1, w: Math.max(1, width - 2), h: Math.max(1, height - 2) };
  const values = chart.series[0]?.values ?? [];
  if (values.length === 0) return [];
  const max = Math.max(1, ...values.map((v) => (v > 0 ? v : 0)));
  const step = plot.w / Math.max(1, values.length);
  const yOf = (v: number): number => plot.y + plot.h - (Math.max(0, v) / max) * plot.h;
  const toSlot: ToSlot = (i) => slotOf(i, values.length, chart.rtl === true);
  return lineSeriesOps(values, PALETTE[0] as Rgb01, plot, step, yOf, toSlot);
}

export function chartOps(chart: LaidChart, width: number, height: number): ChartOp[] {
  if (chart.kind === 'pie' || chart.kind === 'donut') return pieOps(chart, width, height);
  if (chart.kind === 'sparkline') return sparklineOps(chart, width, height);

  const seriesNames = chart.series.map((s) => s.name ?? '').filter(Boolean);
  const legendH = chart.showLegend && seriesNames.length > 0 ? LEGEND_H : 0;
  const plot = {
    x: PAD,
    y: PAD + legendH,
    w: Math.max(1, width - PAD * 2),
    h: Math.max(1, height - PAD * 2 - legendH - AXIS_LABEL_H),
  };
  const baselineY = plot.y + plot.h;
  const rtl = chart.rtl === true;
  // The value axis hugs the reading-start edge, so it flips with the direction.
  const valueAxisX = rtl ? plot.x + plot.w : plot.x;
  const ops: ChartOp[] = [
    {
      op: 'line',
      x1: valueAxisX,
      y1: plot.y,
      x2: valueAxisX,
      y2: baselineY,
      color: AXIS,
      width: 0.75,
    },
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

  // Legend + axis labels (§5). Horizontal bars label their rows instead of
  // the x-axis; every vertical kind centers a category label under its slot.
  if (legendH > 0) {
    ops.push(
      ...legendOps(seriesNames, chart.seriesNameWidths, plot.x, PAD + 1, rtl, plot.x + plot.w),
    );
  }
  if (chart.kind === 'bar') {
    chart.categories.forEach((cat, gi) => {
      const rowH = plot.h / categories;
      ops.push({
        op: 'text',
        x: rtl ? plot.x + plot.w - 2 : plot.x + 2,
        y: plot.y + rowH * gi + rowH / 2 + LABEL_SIZE * 0.35,
        text: cat,
        size: LABEL_SIZE,
        color: LABEL,
        ...(rtl ? { align: 'end' as const } : {}),
      });
    });
  } else {
    chart.categories.forEach((cat, gi) => {
      ops.push({
        op: 'text',
        x: centreOf(plot, step, slotOf(gi, categories, rtl)),
        y: baselineY + LABEL_SIZE + 1.5,
        text: cat,
        size: LABEL_SIZE,
        color: LABEL,
        align: 'middle',
      });
    });
  }
  const axisMax =
    chart.kind === 'stackedColumn'
      ? Math.max(
          1,
          ...Array.from({ length: categories }, (_, gi) =>
            series.reduce((sum, s) => sum + Math.max(0, s.values[gi] ?? 0), 0),
          ),
        )
      : maxValue;
  ops.push({
    op: 'text',
    x: rtl ? valueAxisX - 2 : valueAxisX + 2,
    y: plot.y + LABEL_SIZE,
    text: String(axisMax),
    size: LABEL_SIZE,
    color: LABEL,
    ...(rtl ? { align: 'end' as const } : {}),
  });

  const toSlot: ToSlot = (i) => slotOf(i, categories, rtl);

  if (chart.kind === 'line') {
    series.forEach((s, si) => {
      ops.push(
        ...lineSeriesOps(s.values, PALETTE[si % PALETTE.length] as Rgb01, plot, step, yOf, toSlot),
      );
    });
    return ops;
  }

  if (chart.kind === 'area') {
    series.forEach((s, si) => {
      ops.push(
        ...areaSeriesOps(
          s.values,
          PALETTE[si % PALETTE.length] as Rgb01,
          plot,
          step,
          yOf,
          baselineY,
          toSlot,
        ),
      );
    });
    return ops;
  }

  if (chart.kind === 'scatter') {
    series.forEach((s, si) => {
      ops.push(
        ...scatterSeriesOps(
          s.values,
          PALETTE[si % PALETTE.length] as Rgb01,
          plot,
          step,
          yOf,
          toSlot,
        ),
      );
    });
    return ops;
  }

  // Combo: each series picks its own shape on the shared scale. Only the column
  // series compete for slots within a category, so lines/areas overlay them.
  if (chart.kind === 'combo') {
    const kindOf = (s: (typeof series)[number]): string => s.kind ?? 'column';
    const columnSlots = series.filter((s) => kindOf(s) === 'column').length;
    const groupW = plot.w / categories;
    let slot = 0;
    series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length] as Rgb01;
      switch (kindOf(s)) {
        case 'line':
          ops.push(...lineSeriesOps(s.values, color, plot, step, yOf, toSlot));
          break;
        case 'area':
          ops.push(...areaSeriesOps(s.values, color, plot, step, yOf, baselineY, toSlot));
          break;
        case 'scatter':
          ops.push(...scatterSeriesOps(s.values, color, plot, step, yOf, toSlot));
          break;
        default:
          ops.push(
            ...columnSeriesOps(
              s.values,
              color,
              plot,
              groupW,
              slot,
              columnSlots,
              baselineY,
              yOf,
              toSlot,
            ),
          );
          slot++;
      }
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
          x: plot.x + groupW * toSlot(gi) + groupW * 0.2,
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
        // horizontal bars grow away from the reading-start edge
        const x = rtl ? plot.x + plot.w - len : plot.x;
        ops.push({ op: 'rect', x, y, w: len, h: barH, fill: color });
      });
    });
  } else {
    const groupW = plot.w / groupCount;
    series.forEach((s, si) => {
      ops.push(
        ...columnSeriesOps(
          s.values,
          PALETTE[si % PALETTE.length] as Rgb01,
          plot,
          groupW,
          si,
          seriesCount,
          baselineY,
          yOf,
          toSlot,
        ),
      );
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

  // Reserve a legend column on the side when category names are shown (§5).
  // It sits opposite the reading-start edge — right of the pie under LTR, left
  // of it under RTL — and is sized from measured label widths, not a
  // Latin-calibrated character count that Persian names overflow.
  const rtl = chart.rtl === true;
  const legend = chart.showLegend && chart.categories.length > 0;
  const widest = legend
    ? Math.max(...chart.categories.map((c, i) => labelWidth(c, chart.categoryWidths?.[i])))
    : 0;
  const legendW = legend ? Math.min(width * 0.45, widest + SWATCH + SWATCH_GAP + PAD) : 0;
  const legendX = rtl ? 0 : width - legendW;
  // the pie takes the remaining column, on the other side
  const cx = (rtl ? legendW : 0) + (width - legendW) / 2;
  const cy = height / 2;
  const r = Math.min(width - legendW, height) / 2 - PAD;
  const ri = chart.kind === 'donut' ? r * 0.55 : 0;

  const ops: ChartOp[] = [];
  if (legend) {
    chart.categories.forEach((cat, i) => {
      const y = PAD + i * (LABEL_SIZE + 4);
      // swatch on the reading-start side of its own label
      ops.push({
        op: 'rect',
        x: rtl ? legendX + legendW - SWATCH : legendX,
        y,
        w: SWATCH,
        h: SWATCH,
        fill: PALETTE[i % PALETTE.length] as Rgb01,
      });
      ops.push({
        op: 'text',
        x: rtl ? legendX + legendW - SWATCH - SWATCH_GAP : legendX + SWATCH + SWATCH_GAP,
        y: y + 6.5,
        text: cat,
        size: LABEL_SIZE,
        color: LABEL,
        ...(rtl ? { align: 'end' as const } : {}),
      });
    });
  }
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
