/**
 * Lays out a {@link TableElement} (§5) into positioned cells: a header row, one
 * detail row per bound dataset row, and an optional aggregate footer
 * (sum/avg/count/min/max). Column widths resolve from fixed/percent/auto; columns
 * are ordered right-to-left for RTL tables. Each cell becomes a single
 * `staticText` laid element carrying its own box (border/fill), so the painters
 * draw it with no table-specific code.
 *
 * MVP: the table lays out within its element bounds; cross-page table splitting
 * with a repeated header (§6) is a later step.
 */
import { applyFormat } from '../binding/format-value';
import {
  resolveDirection,
  resolveLocale,
  type ResolvedDirection,
} from '../binding/effective-locale';
import { evaluateExpr } from '../binding/evaluate';
import type { RenderContext } from '../binding/render-context';
import type { Scope } from '../expression/scope';
import type { Aggregate, TableCell, TableColumn, TableElement } from '../model/elements';
import type { Direction, LocaleSetup } from '../model/locale';
import type { BorderSet, NamedStyle, Typography } from '../model/style';
import type { Rect } from '../model/units';
import type { TextMeasurer } from './measure';
import type { LaidOutElement } from './page';

const DEFAULT_ROW_HEIGHT = 18;
const CELL_PADDING = 2;

export interface TableLayoutDeps {
  ctx: RenderContext;
  measurer: TextMeasurer;
  styles: Map<string, NamedStyle>;
  pageLocale: LocaleSetup;
  pageDirection: Direction;
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[];
}

export interface TableLayout {
  /** Cells as laid elements, band-relative (table bounds offset included). */
  elements: LaidOutElement[];
  /** Total laid height of the table. */
  height: number;
}

export function layoutTable(table: TableElement, scope: Scope, deps: TableLayoutDeps): TableLayout {
  const { ctx, measurer, styles, pageLocale, pageDirection, resolveRows } = deps;
  const locale = resolveLocale(pageLocale, undefined, table.locale);
  const direction = resolveDirection(pageDirection, locale, undefined, table.direction);
  const rtl = direction === 'rtl';

  const widths = resolveColumnWidths(table.columns, table.bounds.width);
  const offsets = columnOffsets(widths, table.bounds.width, rtl);
  const rows = resolveRows(table.dataset, scope);

  const elements: LaidOutElement[] = [];
  let y = table.bounds.y;

  const hasHeader = table.columns.some((c) => c.header);
  const hasFooter = table.columns.some((c) => c.footer);

  // Header row -------------------------------------------------------------
  if (hasHeader) {
    const texts = table.columns.map((c) => cellText(c.header, scope, locale, ctx, table.id));
    const h = rowHeight(texts, widths, measurer);
    table.columns.forEach((col, ci) => {
      // Header cells repeat when the table splits across pages (§6).
      elements.push({
        ...cell(
          table,
          `h${ci}`,
          texts[ci] ?? '',
          rectAt(table, offsets[ci]!, y, widths[ci]!, h),
          col.header,
          direction,
          styles,
          undefined,
        ),
        repeatOnSplit: true,
      });
    });
    y += h;
  }

  // Detail rows ------------------------------------------------------------
  rows.forEach((row, r) => {
    const rowScope = scope.child(row, { $index: r, $first: r === 0, $last: r === rows.length - 1 });
    const texts = table.columns.map((c) => cellText(c.detail, rowScope, locale, ctx, table.id));
    const h = rowHeight(texts, widths, measurer);
    const stripe = r % 2 === 1 ? table.rowStripeStyleId : undefined;
    table.columns.forEach((col, ci) => {
      elements.push(
        cell(
          table,
          `r${r}c${ci}`,
          texts[ci] ?? '',
          rectAt(table, offsets[ci]!, y, widths[ci]!, h),
          col.detail,
          direction,
          styles,
          stripe,
        ),
      );
    });
    y += h;
  });

  // Aggregate footer -------------------------------------------------------
  if (hasFooter) {
    const texts = table.columns.map((col) => footerText(col, rows, scope, locale, ctx, table.id));
    const h = rowHeight(texts, widths, measurer);
    table.columns.forEach((col, ci) => {
      elements.push(
        cell(
          table,
          `f${ci}`,
          texts[ci] ?? '',
          rectAt(table, offsets[ci]!, y, widths[ci]!, h),
          col.footer,
          direction,
          styles,
          undefined,
        ),
      );
    });
    y += h;
  }

  return { elements, height: y - table.bounds.y };
}

// --- helpers ---------------------------------------------------------------

export function resolveColumnWidths(columns: TableColumn[], totalWidth: number): number[] {
  let used = 0;
  let autoCount = 0;
  const widths = columns.map((c) => {
    if (c.width.kind === 'fixed') {
      used += c.width.value;
      return c.width.value;
    }
    if (c.width.kind === 'percent') {
      const w = (totalWidth * c.width.value) / 100;
      used += w;
      return w;
    }
    autoCount++;
    return -1;
  });
  const autoWidth = autoCount > 0 ? Math.max(0, totalWidth - used) / autoCount : 0;
  return widths.map((w) => (w < 0 ? autoWidth : w));
}

/** Left x of each column; right-to-left when `rtl` so column 0 sits on the right. */
function columnOffsets(widths: number[], totalWidth: number, rtl: boolean): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const w of widths) {
    offsets.push(rtl ? totalWidth - cursor - w : cursor);
    cursor += w;
  }
  return offsets;
}

function rectAt(table: TableElement, colX: number, y: number, width: number, height: number): Rect {
  return { x: table.bounds.x + colX, y, width, height };
}

function cellText(
  cell: TableCell | undefined,
  scope: Scope,
  locale: LocaleSetup,
  ctx: RenderContext,
  elementId: string,
): string {
  if (!cell) return '';
  if (cell.text !== undefined) return cell.text;
  if (cell.content) {
    const value = evaluateExpr(cell.content.source, scope, ctx, locale.digits, elementId);
    return applyFormat(value, undefined, locale).text;
  }
  return '';
}

function footerText(
  col: TableColumn,
  rows: Record<string, unknown>[],
  scope: Scope,
  locale: LocaleSetup,
  ctx: RenderContext,
  elementId: string,
): string {
  const footer = col.footer;
  if (!footer) return '';
  if (footer.text !== undefined) return footer.text;
  if (footer.aggregate && col.detail?.content) {
    const expr = col.detail.content.source;
    const values = rows.map((row, r) =>
      Number(evaluateExpr(expr, scope.child(row, { $index: r }), ctx, locale.digits, elementId)),
    );
    return applyFormat(aggregate(footer.aggregate, values), undefined, locale).text;
  }
  return cellText(footer, scope, locale, ctx, elementId);
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

function rowHeight(texts: string[], widths: number[], measurer: TextMeasurer): number {
  let max = DEFAULT_ROW_HEIGHT;
  texts.forEach((text, ci) => {
    const measured = measurer.measure(text, { fontSize: 12 }, (widths[ci] ?? 0) - CELL_PADDING * 2);
    max = Math.max(max, measured.height + CELL_PADDING * 2);
  });
  return max;
}

function cell(
  table: TableElement,
  key: string,
  text: string,
  bounds: Rect,
  cellDef: TableCell | undefined,
  direction: ResolvedDirection,
  styles: Map<string, NamedStyle>,
  stripeStyleId: string | undefined,
): LaidOutElement {
  const named = cellDef?.styleId ? styles.get(cellDef.styleId) : undefined;
  const stripe = stripeStyleId ? styles.get(stripeStyleId) : undefined;
  const typography: Typography | undefined = named?.typography;
  const fill = named?.box?.fill ?? stripe?.box?.fill;
  const border: BorderSet | undefined = table.border ? { all: table.border } : named?.box?.border;

  const box =
    fill || border ? { ...(fill ? { fill } : {}), ...(border ? { border } : {}) } : undefined;

  return {
    id: `${table.id}:${key}`,
    type: 'staticText',
    bounds,
    rotation: 0,
    zIndex: table.zIndex,
    direction,
    text,
    ...(typography ? { typography } : {}),
    ...(box ? { box } : {}),
    source: table,
  };
}
