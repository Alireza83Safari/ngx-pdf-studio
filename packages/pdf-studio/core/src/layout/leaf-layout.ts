/**
 * Lays out a single non-composite element (text, field, page-field, shapes,
 * image, barcode) into one {@link LaidOutElement} with band-relative bounds.
 * Shared by the band flow and by repeaters (list items, table cells) so element
 * resolution — locale, direction (incl. content-based bidi), style cascade, text
 * measurement, barcode encoding — lives in exactly one place.
 */
import type { BarcodeRegistry } from '../barcode/registry';
import {
  resolveDirection,
  resolveLocale,
  type ResolvedDirection,
} from '../binding/effective-locale';
import { evaluateExpr } from '../binding/evaluate';
import { applyFormat } from '../binding/format-value';
import type { RenderContext } from '../binding/render-context';
import type { Scope } from '../expression/scope';
import type { AnyElement } from '../model/elements';
import type { Direction, LocaleSetup } from '../model/locale';
import type { ImageResource } from '../model/resource';
import type { BoxStyle, NamedStyle, Typography } from '../model/style';
import type { Rect } from '../model/units';
import { colorScaleColor, dataBarFraction, pickIcon } from './conditional-visuals';
import { toPersianDigits } from '../expression/digits';
import { justifyLineWithKashida } from '../i18n/kashida';
import type { ElementRegistry } from './element-registry';
import { resolveImage } from './image-resolve';
import { resolveChart } from './chart-resolve';
import { resolveRichText } from './richtext-layout';
import { resolveQr } from './qr-resolve';
import type { TextMeasurer } from './measure';
import type {
  BookmarkEntry,
  LaidChart,
  LaidImage,
  LaidOutElement,
  LaidQr,
  LaidRichText,
  VectorOp,
} from './page';

const DEFAULT_FONT_SIZE = 12;

export interface LeafDeps {
  ctx: RenderContext;
  measurer: TextMeasurer;
  styles: Map<string, NamedStyle>;
  pageLocale: LocaleSetup;
  pageDirection: Direction;
  barcodes: BarcodeRegistry;
  /** Custom-element renderers (§12). */
  elements: ElementRegistry;
  images: Map<string, ImageResource>;
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[];
  /** Document bookmarks from the first pagination pass, for `toc` elements (§11A-D). */
  tocEntries: BookmarkEntry[];
}

export const mergeTypography = (a?: Typography, b?: Typography): Typography | undefined =>
  a || b ? { ...a, ...b } : undefined;
export const mergeBox = (a?: BoxStyle, b?: BoxStyle): BoxStyle | undefined =>
  a || b ? { ...a, ...b } : undefined;

/** Evaluate `visibleWhen`/`printWhen`; `false` skips the element (§5). */
export function isVisible(
  el: AnyElement,
  scope: Scope,
  locale: LocaleSetup,
  ctx: RenderContext,
): boolean {
  if (el.visibleWhen && !truthy(evaluateExpr(el.visibleWhen.source, scope, ctx, locale.digits))) {
    return false;
  }
  if (el.printWhen && !truthy(evaluateExpr(el.printWhen.source, scope, ctx, locale.digits))) {
    return false;
  }
  return true;
}

export function layoutLeaf(
  el: AnyElement,
  scope: Scope,
  bandLocale: Partial<LocaleSetup> | undefined,
  bandDirection: Direction | undefined,
  deps: LeafDeps,
): LaidOutElement {
  const locale = resolveLocale(deps.pageLocale, bandLocale, el.locale);
  const named = el.styleId ? deps.styles.get(el.styleId) : undefined;
  let typography = mergeTypography(named?.typography, el.typography);
  let box = mergeBox(named?.box, el.box);

  // Data-driven conditional styling: overlay each matching condition (§11A-D).
  for (const cond of el.conditionalStyles ?? []) {
    if (truthy(evaluateExpr(cond.when.source, scope, deps.ctx, locale.digits))) {
      typography = mergeTypography(typography, cond.typography);
      box = mergeBox(box, cond.box);
    }
  }

  let text = resolveText(el, scope, locale, deps.ctx);
  const direction = resolveDirection(deps.pageDirection, locale, bandDirection, el.direction, text);

  let bounds: Rect = { ...el.bounds };
  let lines: string[] | undefined;
  let barcode: boolean[] | undefined;
  let barcodeText: string | undefined;
  let image: LaidImage | undefined;
  let chart: LaidChart | undefined;
  let richText: LaidRichText | undefined;
  let qr: LaidQr | undefined;
  let custom: VectorOp[] | undefined;

  if (el.type === 'image') {
    image = resolveImage(el, scope, locale, deps);
  }
  if (el.type === 'chart') {
    chart = resolveChart(el, scope, locale, deps);
  }
  if (el.type === 'qrcode') {
    qr = resolveQr(el, scope, locale, deps);
  }
  if (el.type === 'richText') {
    const laid = resolveRichText(el, scope, locale, deps);
    richText = laid.richText;
    bounds = { ...el.bounds, height: Math.max(el.bounds.height, laid.height) };
  }

  if (el.type === 'barcode') {
    const value = evaluateExpr(el.value.source, scope, deps.ctx, locale.digits);
    const text = value == null ? '' : String(value);
    const bits = deps.barcodes.encode(el.symbology, text);
    if (bits) {
      barcode = bits;
      if (el.showText) barcodeText = text;
    } else {
      deps.ctx.diagnostics.push({
        severity: 'warning',
        message: `No encoder registered for barcode symbology '${el.symbology}'`,
      });
    }
  }

  if (el.type === 'custom') {
    const value = el.value
      ? evaluateExpr(el.value.source, scope, deps.ctx, locale.digits)
      : undefined;
    custom = deps.elements.render(el.renderer, {
      value,
      options: el.options ?? {},
      width: el.bounds.width,
      height: el.bounds.height,
    });
    if (!custom) {
      deps.ctx.diagnostics.push({
        severity: 'warning',
        message: `No renderer registered for custom element '${el.renderer}'`,
      });
    }
  }

  if (text !== undefined) {
    const fontSize = typography?.fontSize ?? DEFAULT_FONT_SIZE;
    const measured = deps.measurer.measure(
      text,
      {
        fontSize,
        ...(typography?.lineHeight !== undefined ? { lineHeight: typography.lineHeight } : {}),
        ...(typography?.fontFamily !== undefined ? { fontFamily: typography.fontFamily } : {}),
      },
      el.bounds.width,
    );
    lines = measured.lines;
    bounds = { ...el.bounds, height: Math.max(el.bounds.height, measured.height) };

    // Persian kashida justification (§11, ROADMAP ۱.۴): stretch every line
    // except the last to the element width by elongating letter joins.
    if (typography?.align === 'justify' && lines.length > 1) {
      const style = {
        fontSize,
        ...(typography?.lineHeight !== undefined ? { lineHeight: typography.lineHeight } : {}),
        ...(typography?.fontFamily !== undefined ? { fontFamily: typography.fontFamily } : {}),
      };
      const tatweelWidth = deps.measurer.measure('ـ', style).width;
      lines = lines.map((line, i) => {
        if (i === lines!.length - 1) return line;
        const deficit = el.bounds.width - deps.measurer.measure(line, style).width;
        return justifyLineWithKashida(line, deficit, tatweelWidth);
      });
    }
  }

  // Auto table of contents (§11A-D): one clipped line per bookmark entry.
  // Fixed bounds keep the second pagination pass byte-stable.
  if (el.type === 'toc') {
    const lh = el.lineHeight ?? 16;
    const maxDepth = el.maxDepth ?? Number.POSITIVE_INFINITY;
    const maxLines = Math.max(0, Math.floor(el.bounds.height / lh));
    const fmtPage = (n: number): string =>
      locale.digits === 'persian' ? toPersianDigits(String(n)) : String(n);
    lines = deps.tocEntries
      .filter((entry) => entry.level <= maxDepth)
      .slice(0, maxLines)
      .map(
        (entry) =>
          `${'    '.repeat(entry.level)}${entry.title}  ......  ${fmtPage(entry.pageIndex + 1)}`,
      );
    text = lines[0] !== undefined ? lines.join('\n') : '';
    typography = mergeTypography(typography, { lineHeight: lh });
  }

  let bookmark: { title: string; level: number } | undefined;
  if (el.bookmark) {
    const title = el.bookmark.title
      ? String(evaluateExpr(el.bookmark.title.source, scope, deps.ctx, locale.digits) ?? '')
      : (text ?? '');
    bookmark = { title, level: el.bookmark.level ?? 0 };
  }

  // Value-driven color scale: overlay the interpolated color as the box fill
  // so it flows through the existing fill painting in both painters (§11A-D).
  if (el.colorScale) {
    const v = Number(evaluateExpr(el.colorScale.value.source, scope, deps.ctx, locale.digits));
    if (Number.isFinite(v)) {
      box = mergeBox(box, { fill: { color: colorScaleColor(el.colorScale.stops, v) } });
    }
  }

  let dataBar: LaidOutElement['dataBar'];
  if (el.dataBar) {
    const v = Number(evaluateExpr(el.dataBar.value.source, scope, deps.ctx, locale.digits));
    if (Number.isFinite(v)) {
      dataBar = {
        fraction: dataBarFraction(v, el.dataBar.max, el.dataBar.min),
        color: el.dataBar.color,
      };
    }
  }

  let icon: LaidOutElement['icon'];
  if (el.iconSet && el.iconSet.thresholds.length > 0) {
    const v = Number(evaluateExpr(el.iconSet.value.source, scope, deps.ctx, locale.digits));
    if (Number.isFinite(v)) icon = pickIcon(el.iconSet, v);
  }

  let formField: LaidOutElement['formField'];
  if (el.type === 'formField') {
    const raw = el.defaultValue
      ? evaluateExpr(el.defaultValue.source, scope, deps.ctx, locale.digits)
      : undefined;
    formField = {
      kind: el.fieldKind,
      name: el.fieldName,
      value: raw == null ? '' : String(raw),
      checked: Boolean(raw),
      multiline: el.multiline ?? false,
    };
  }

  let link: LaidOutElement['link'];
  if (el.link) {
    const target = evaluateExpr(el.link.target.source, scope, deps.ctx, locale.digits);
    if (el.link.kind === 'url') {
      if (target != null && String(target) !== '') link = { kind: 'url', url: String(target) };
    } else {
      const pageNum = Number(target);
      if (Number.isFinite(pageNum)) link = { kind: 'page', page: Math.trunc(pageNum) };
    }
  }

  return {
    id: el.id,
    type: el.type,
    bounds,
    rotation: el.rotation ?? 0,
    zIndex: el.zIndex,
    direction,
    ...(bookmark ? { bookmark } : {}),
    ...(link ? { link } : {}),
    ...(dataBar ? { dataBar } : {}),
    ...(icon ? { icon } : {}),
    ...(formField ? { formField } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(lines ? { lines } : {}),
    ...(barcode ? { barcode } : {}),
    ...(barcodeText !== undefined ? { barcodeText } : {}),
    ...(custom ? { custom } : {}),
    ...(qr ? { qr } : {}),
    ...(image ? { image } : {}),
    ...(chart ? { chart } : {}),
    ...(richText ? { richText } : {}),
    ...(typography ? { typography } : {}),
    ...(box ? { box } : {}),
    source: el,
  };
}

const truthy = (v: unknown): boolean => Boolean(v);

function resolveText(
  el: AnyElement,
  scope: Scope,
  locale: LocaleSetup,
  ctx: RenderContext,
): string | undefined {
  switch (el.type) {
    case 'staticText':
      return el.text;
    case 'dataField': {
      const value = evaluateExpr(el.value.source, scope, ctx, locale.digits);
      if (value === null || value === undefined) return el.fallback ?? '';
      const outcome = applyFormat(value, el.format, locale);
      if (outcome.warning) ctx.diagnostics.push({ severity: 'warning', message: outcome.warning });
      return outcome.text;
    }
    case 'pageField': {
      const value =
        el.field === 'page'
          ? scope.resolve('$page').value
          : el.field === 'pageCount'
            ? scope.resolve('$pageCount').value
            : ctx.now();
      const fallbackFormat =
        el.field === 'currentDate' ? ({ kind: 'date' } as const) : ({ kind: 'number' } as const);
      return applyFormat(value, el.format ?? fallbackFormat, locale).text;
    }
    default:
      return undefined;
  }
}

/** Direction of a laid element, re-exported for painters that branch on it. */
export type { ResolvedDirection };
