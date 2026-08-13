/**
 * The pagination engine (§6): a pure function `(template, data) → Page[]`. It
 * flows bands across pages, repeats page header/footer on every page, reserves
 * their space, iterates `detail` bands over their dataset rows, breaks to a new
 * page on overflow, and resolves `$page`/`$pageCount`/`$index`/`$first`/`$last`.
 * No DOM; deterministic for snapshot testing.
 *
 * MVP scope (Phase 1): single column; one each of report/page header & footer
 * plus `detail` bands; auto-grow heights via the injected {@link TextMeasurer}.
 * Grouping, columns, table/list flow, and true cross-page row splitting land in
 * Phase 2 — unsupported band types are reported, not silently dropped.
 */
import { createDefaultBarcodes, type BarcodeRegistry } from '../barcode/registry';
import { resolveLocale } from '../binding/effective-locale';
import { evaluateExpr } from '../binding/evaluate';
import { resolveDataset } from '../binding/dataset-resolver';
import type { RenderContext } from '../binding/render-context';
import type { EvaluationBudget } from '../expression/budget';
import { Scope, type BuiltinVars } from '../expression/scope';
import { buildGroupedFlow, type FlowItem } from './grouping';
import { computeRowVariables } from './report-variables';
import { createDefaultElements, type ElementRegistry } from './element-registry';
import { layoutCrosstab } from './crosstab-layout';
import type { Band } from '../model/band';
import type { DatasetDef } from '../model/dataset';
import type { AnyElement } from '../model/elements';
import type { PageSetup } from '../model/page';
import type { ImageResource } from '../model/resource';
import type { NamedStyle } from '../model/style';
import type { PdfTemplate } from '../model/template';
import type { EdgeInsets, Rect, Size } from '../model/units';
import type { VariableDef } from '../model/variable';
import { isVisible, layoutLeaf, type LeafDeps } from './leaf-layout';
import { createBudget, LayoutLimitError, resolveLimits, type LayoutLimits } from './limits';
import { layoutList } from './list-layout';
import { SimpleTextMeasurer, type TextMeasurer } from './measure';
import { pageSizeProblem, resolvePageSize } from './page-size';
import type {
  BookmarkEntry,
  LaidBand,
  LaidOutElement,
  LayoutPage,
  PaginatedDocument,
} from './page';
import { layoutTable, type TableLayoutDeps } from './table-layout';

const EPSILON = 0.01;

/** A registered subreport: its own bands + datasets, run against supplied data. */
export interface SubreportTemplate {
  bands: Band[];
  datasets?: DatasetDef[];
}

export interface PaginateOptions {
  /** Text measurer; defaults to the deterministic estimator (§7). */
  measurer?: TextMeasurer;
  /** Barcode symbology registry; defaults to the built-ins (§5, §12). */
  barcodes?: BarcodeRegistry;
  /** Custom-element renderer registry (§12); empty by default. */
  elements?: ElementRegistry;
  /** Subreport templates by `templateRef` (§5). */
  subreports?: Record<string, SubreportTemplate>;
  /**
   * Ceilings on total work — pages, rows per dataset, expression steps for the
   * whole document. Generous by default so authored reports never meet them;
   * tighten when rendering templates you did not author. See {@link LayoutLimits}.
   */
  limits?: LayoutLimits;
}

interface BandLayout {
  elements: LaidOutElement[];
  height: number;
}

/** Does any band (top-level or section) contain a `toc` element? */
function hasTocElement(template: PdfTemplate): boolean {
  const bands = [...template.bands, ...(template.sections ?? []).flatMap((s) => s.bands)];
  return bands.some((band) => band.elements.some((el) => el.type === 'toc'));
}

export function paginate(
  template: PdfTemplate,
  ctx: RenderContext,
  options: PaginateOptions = {},
): PaginatedDocument {
  const limits = resolveLimits(options.limits);
  // One budget for the whole render, not one per pass: a two-pass ToC document
  // must not be allowed to spend twice what a one-pass document may.
  const budget = createBudget(limits.maxExpressionSteps);

  // Auto ToC needs page numbers, which need pagination: run a first pass with
  // no entries, then re-run with the collected bookmarks. ToC elements have
  // fixed bounds, so the second pass cannot shift any page break (§11A-D).
  const first = paginatePass(template, ctx, options, [], limits, budget);
  if (!hasTocElement(template)) return first;
  return paginatePass(template, ctx, options, first.bookmarks, limits, budget);
}

function paginatePass(
  template: PdfTemplate,
  outerCtx: RenderContext,
  options: PaginateOptions,
  tocEntries: BookmarkEntry[],
  limits: Required<LayoutLimits>,
  budget: EvaluationBudget,
): PaginatedDocument {
  const measurer = options.measurer ?? new SimpleTextMeasurer();
  const styles = new Map(template.styles.map((s) => [s.id, s] as const));
  // A copy, so the budget rides along to every `evaluateExpr` below without
  // mutating the context the caller handed in.
  const ctx: RenderContext = { ...outerCtx, budget };
  const rootScope = Scope.create({ data: ctx.data, parameters: ctx.parameters });
  const shared: SharedDeps = {
    ctx,
    limits,
    measurer,
    styles,
    rootScope,
    barcodes: options.barcodes ?? createDefaultBarcodes(),
    elements: options.elements ?? createDefaultElements(),
    images: new Map(template.resources.images.map((img) => [img.id, img] as const)),
    resolveRows: (datasetName, scope) => {
      const rows = resolveDataset(findDataset(template, datasetName, ctx), scope, ctx);
      // Checked here rather than in the resolver: this is the only place rows
      // become layout work, and the resolver is also used for things that never
      // reach a page.
      if (rows.length > limits.maxRows) {
        throw new LayoutLimitError(
          'rows',
          limits.maxRows,
          `dataset '${datasetName}' resolved ${rows.length} rows`,
        );
      }
      return rows;
    },
    subreports: new Map(Object.entries(options.subreports ?? {})),
    variables: template.variables ?? [],
    tocEntries,
  };

  // One implicit section from the top-level page+bands, unless sections declared.
  const sections =
    template.sections && template.sections.length > 0
      ? template.sections
      : [{ id: '__main__', page: template.page, bands: template.bands }];

  const plans = sections.map((section) => planSection(section.page, section.bands, shared));
  const pageCount = plans.reduce((sum, plan) => sum + plan.bodies.length, 0);
  // Each section was capped on its own way up; the document is the sum, and
  // enough sections under the cap still add up to a document over it.
  if (pageCount > limits.maxPages) {
    throw new LayoutLimitError('pages', limits.maxPages, `document produced ${pageCount}`);
  }

  // Numbering groups (§11A-E): a new group starts at the document and at every
  // section flagged `restartPageNumbers`. `$page`/`$pageCount` are local to the
  // group; physical page indices stay absolute (links/bookmarks reference them).
  const groups: SectionPlan[][] = [];
  sections.forEach((section, i) => {
    if (i === 0 || section.restartPageNumbers) groups.push([]);
    (groups[groups.length - 1] as SectionPlan[]).push(plans[i] as SectionPlan);
  });

  const pages: LayoutPage[] = [];
  for (const group of groups) {
    const groupCount = group.reduce((sum, plan) => sum + plan.bodies.length, 0);
    let localNumber = 1;
    for (const plan of group) {
      plan.bodies.forEach((bodyElements, i) => {
        pages.push(
          finalizePage(
            plan,
            bodyElements,
            plan.bodyBands[i] ?? [],
            pages.length,
            localNumber,
            groupCount,
            rootScope,
          ),
        );
        localNumber += 1;
      });
    }
  }

  return { pages, pageCount, diagnostics: ctx.diagnostics, bookmarks: collectBookmarks(pages) };
}

/** Gather element bookmarks into a flat, document-ordered outline list. */
function collectBookmarks(pages: LayoutPage[]): BookmarkEntry[] {
  const entries: BookmarkEntry[] = [];
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.bookmark) {
        entries.push({
          title: el.bookmark.title,
          level: el.bookmark.level,
          pageIndex: page.index,
          y: el.bounds.y,
        });
      }
    }
  }
  return entries.sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y);
}

interface SharedDeps {
  ctx: RenderContext;
  limits: Required<LayoutLimits>;
  measurer: TextMeasurer;
  styles: Map<string, NamedStyle>;
  rootScope: Scope;
  barcodes: ReturnType<typeof createDefaultBarcodes>;
  elements: ElementRegistry;
  images: Map<string, ImageResource>;
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[];
  subreports: Map<string, SubreportTemplate>;
  variables: VariableDef[];
  /** Bookmark entries from pass 1, consumed by `toc` elements in pass 2. */
  tocEntries: BookmarkEntry[];
}

interface SectionPlan {
  size: Size;
  content: Rect;
  availTop: number;
  availBottom: number;
  byType: BandBuckets;
  bodies: LaidOutElement[][];
  /** Band strips per body page, one entry for each entry in `bodies` (§6). */
  bodyBands: LaidBand[][];
  layoutBand: (band: Band, scope: Scope) => BandLayout;
}

/** Lay out a section into body pages (no global page numbers resolved yet). */
function planSection(page: PageSetup, bands: Band[], shared: SharedDeps): SectionPlan {
  const {
    ctx,
    limits,
    measurer,
    styles,
    rootScope,
    barcodes,
    elements,
    images,
    resolveRows,
    subreports,
  } = shared;
  const sizeProblem = pageSizeProblem(page.size);
  if (sizeProblem) warnOnce(ctx, `${sizeProblem} — falling back to A4`);
  const size = resolvePageSize(page.size, page.orientation);
  const content = contentRect(size, page.margins);
  const byType = categorizeBands(bands, ctx);

  const tableDeps: TableLayoutDeps = {
    ctx,
    measurer,
    styles,
    pageLocale: page.locale,
    pageDirection: page.direction,
    resolveRows,
  };
  const leafDeps: LeafDeps = {
    ctx,
    measurer,
    styles,
    pageLocale: page.locale,
    pageDirection: page.direction,
    barcodes,
    elements,
    images,
    resolveRows,
    tocEntries: shared.tocEntries,
  };
  const layoutBand = (band: Band, scope: Scope): BandLayout =>
    layoutBandImpl(band, scope, leafDeps, tableDeps, resolveRows, subreports);

  // Reserve the tallest master variant so the body never collides on any page.
  const headerHeight = Math.max(
    0,
    ...byType.pageHeaders.map((b) => layoutBand(b, rootScope).height),
  );
  const footerHeight = Math.max(
    0,
    ...byType.pageFooters.map((b) => layoutBand(b, rootScope).height),
  );
  const availTop = content.y + headerHeight;
  const availBottom = content.y + content.height - footerHeight;

  const flow = buildBodyFlow(
    byType,
    rootScope,
    ctx,
    page.locale.digits,
    resolveRows,
    shared.variables,
  );

  // Multi-column flow (§5): bands fill column 0 top-to-bottom, then column 1,
  // …, breaking to a new page only when the last column overflows. Bands are
  // assumed authored at column width. `count: 1` reduces to single-column.
  const colCount = page.columns && page.columns.count > 1 ? page.columns.count : 1;
  const colGap = colCount > 1 ? (page.columns?.gap ?? 0) : 0;
  const colWidth = (content.width - colGap * (colCount - 1)) / colCount;
  const colX = (i: number): number => content.x + i * (colWidth + colGap);

  const bodies: LaidOutElement[][] = [];
  // Band strips, collected alongside the elements so the flow reports where it
  // actually put each band instead of leaving callers to re-derive it (§6).
  const bodyBands: LaidBand[][] = [];
  let current: LaidOutElement[] = [];
  let currentBands: LaidBand[] = [];
  let col = 0;
  let cursorY = availTop;
  const newPage = (): void => {
    bodies.push(current);
    bodyBands.push(currentBands);
    // The cheapest place to notice a runaway: a template that cannot make
    // progress produces pages forever, and every other symptom of that (memory,
    // time, an unresponsive process) shows up later and reads as something else.
    if (bodies.length > limits.maxPages) {
      throw new LayoutLimitError('pages', limits.maxPages, `section produced ${bodies.length}`);
    }
    current = [];
    currentBands = [];
    col = 0;
    cursorY = availTop;
  };
  const nextColumn = (): void => {
    if (col + 1 < colCount) {
      col += 1;
      cursorY = availTop;
    } else {
      newPage();
    }
  };

  const fullCapacity = availBottom - availTop;
  for (const item of flow) {
    // A band boundary is where an exhausted expression budget becomes a
    // decision. The evaluator only records that it ran out — it owes its caller
    // a value, not an exception — so the check belongs here, where stopping
    // still means "no document" rather than "half a document".
    if (ctx.budget?.exhausted) {
      throw new LayoutLimitError(
        'expressionSteps',
        limits.maxExpressionSteps,
        `exhausted while laying out band '${item.band.id}'`,
      );
    }
    if (breaksBefore(item.band) && (col > 0 || current.length > 0)) newPage();
    const laid = layoutBand(item.band, item.scope);
    // A band taller than a whole empty page is split by rows, repeating its
    // `repeatOnSplit` elements (table headers) atop each continuation (§6).
    const pieces =
      laid.height > fullCapacity + EPSILON ? splitBandLayout(laid, fullCapacity) : [laid];
    for (let p = 0; p < pieces.length; p++) {
      const piece = pieces[p] as BandLayout;
      const colHasContent = cursorY > availTop + EPSILON;
      if (cursorY + piece.height > availBottom + EPSILON && colHasContent) nextColumn();
      for (const el of piece.elements) current.push(translate(el, colX(col), cursorY));
      currentBands.push({
        id: item.band.id,
        type: item.band.type,
        bounds: { x: colX(col), y: cursorY, width: colWidth, height: piece.height },
        ...(p > 0 ? { continued: true } : {}),
      });
      cursorY += piece.height;
    }
    if (breaksAfter(item.band)) newPage();
  }
  if (current.length > 0 || bodies.length === 0) {
    bodies.push(current);
    bodyBands.push(currentBands);
  }

  return { size, content, availTop, availBottom, byType, bodies, bodyBands, layoutBand };
}

/**
 * Split an oversized band layout into page-sized chunks at row boundaries
 * (elements sharing a top edge form a row). Elements flagged `repeatOnSplit`
 * (table header cells) are re-emitted at their original position atop every
 * continuation chunk, with the continuing rows shifted up beneath them (§6).
 */
function splitBandLayout(laid: BandLayout, maxHeight: number): BandLayout[] {
  const repeats = laid.elements.filter((e) => e.repeatOnSplit);
  const rest = laid.elements.filter((e) => !e.repeatOnSplit);
  if (rest.length === 0) return [laid];

  // Group into rows by top edge, in reading order.
  const byTop = new Map<number, LaidOutElement[]>();
  for (const el of rest) {
    const key = Math.round(el.bounds.y * 100) / 100;
    const row = byTop.get(key);
    if (row) row.push(el);
    else byTop.set(key, [el]);
  }
  const rows = [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, els]) => els);

  const repeatBottom = repeats.length
    ? Math.max(...repeats.map((e) => e.bounds.y + e.bounds.height))
    : 0;

  const chunks: BandLayout[] = [];
  let els: LaidOutElement[] = [...repeats];
  let shift = 0;
  let bottom = repeatBottom;
  let hasContent = false;

  for (const row of rows) {
    const rowTop = Math.min(...row.map((e) => e.bounds.y));
    const rowBottom = Math.max(...row.map((e) => e.bounds.y + e.bounds.height));
    if (rowBottom - shift > maxHeight + EPSILON && hasContent) {
      chunks.push({ elements: els, height: bottom });
      shift = rowTop - repeatBottom;
      els = [...repeats];
      bottom = repeatBottom;
      hasContent = false;
    }
    for (const el of row) els.push(translate(el, 0, -shift));
    bottom = Math.max(bottom, rowBottom - shift);
    hasContent = true;
  }
  chunks.push({ elements: els, height: bottom });
  return chunks;
}

/** A band forces the flow onto a fresh page/column before it is placed (§5). */
const breaksBefore = (band: Band): boolean => band.pageBreakBefore === true;
/** A band forces a page break after it, incl. a contained `pageBreak` element. */
const breaksAfter = (band: Band): boolean =>
  band.pageBreakAfter === true || band.elements.some((el) => el.type === 'pageBreak');

/**
 * Build the ordered body flow (report header → grouped/detail rows → report
 * footer) shared by section pagination and subreport block layout.
 */
function buildBodyFlow(
  byType: BandBuckets,
  rootScope: Scope,
  ctx: RenderContext,
  digits: 'latn' | 'persian',
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[],
  variables: VariableDef[],
): FlowItem[] {
  const grouped = byType.groupHeaders.length > 0 || byType.groupFooters.length > 0;
  const flow: FlowItem[] = [];
  if (byType.reportHeader) flow.push({ band: byType.reportHeader, scope: rootScope });
  for (const detail of byType.detail) {
    const rows = detail.dataset ? resolveRows(detail.dataset, rootScope) : [{}];
    const varsByRow = computeRowVariables(
      variables,
      rows,
      byType.groupHeaders,
      rootScope,
      ctx,
      digits,
    );
    if (grouped) {
      flow.push(
        ...buildGroupedFlow({
          detail,
          rows,
          groupHeaders: byType.groupHeaders,
          groupFooters: byType.groupFooters,
          rootScope,
          ctx,
          digits,
          varsByRow,
        }),
      );
    } else {
      rows.forEach((row, index) => {
        const builtins: BuiltinVars = {
          $index: index,
          $first: index === 0,
          $last: index === rows.length - 1,
          $vars: varsByRow.get(row) ?? {},
        };
        flow.push({ band: detail, scope: rootScope.child(row, builtins) });
      });
    }
  }
  if (byType.reportFooter) flow.push({ band: byType.reportFooter, scope: rootScope });
  return flow;
}

/** Compose one page: background, repeating header, body, repeating footer. */
function finalizePage(
  plan: SectionPlan,
  bodyElements: LaidOutElement[],
  bodyBands: LaidBand[],
  index: number,
  number: number,
  pageCount: number,
  rootScope: Scope,
): LayoutPage {
  const { byType, content, availBottom, layoutBand } = plan;
  const pageScope = rootScope.child({}, { $page: number, $pageCount: pageCount });
  const elements: LaidOutElement[] = [];
  const bands: LaidBand[] = [];

  for (const bg of byType.background) {
    const laid = layoutBand(bg, pageScope);
    for (const el of laid.elements) elements.push(translate(el, 0, 0));
    // background/watermark span the sheet by contract, so that is their strip
    bands.push({
      id: bg.id,
      type: bg.type,
      bounds: { x: 0, y: 0, width: plan.size.width, height: plan.size.height },
    });
  }
  const pageHeader = selectMaster(byType.pageHeaders, number);
  if (pageHeader) {
    const laid = layoutBand(pageHeader, pageScope);
    for (const el of laid.elements) elements.push(translate(el, content.x, content.y));
    bands.push({
      id: pageHeader.id,
      type: pageHeader.type,
      bounds: { x: content.x, y: content.y, width: content.width, height: laid.height },
    });
  }
  elements.push(...bodyElements);
  bands.push(...bodyBands);
  const pageFooter = selectMaster(byType.pageFooters, number);
  if (pageFooter) {
    const laid = layoutBand(pageFooter, pageScope);
    for (const el of laid.elements) elements.push(translate(el, content.x, availBottom));
    bands.push({
      id: pageFooter.id,
      type: pageFooter.type,
      bounds: { x: content.x, y: availBottom, width: content.width, height: laid.height },
    });
  }

  elements.sort((a, b) => a.zIndex - b.zIndex);
  return { index, number, size: plan.size, elements, bands };
}

/** Pick the most specific master band applicable to `pageNumber` (§11A-E). */
function selectMaster(bands: Band[], pageNumber: number): Band | undefined {
  const applies = (master: Band['master']): boolean => {
    switch (master) {
      case 'first':
        return pageNumber === 1;
      case 'odd':
        return pageNumber % 2 === 1;
      case 'even':
        return pageNumber % 2 === 0;
      default:
        return true; // 'all' / undefined
    }
  };
  const rank = (master: Band['master']): number =>
    master === 'first' ? 3 : master === 'odd' || master === 'even' ? 2 : 1;

  let best: Band | undefined;
  for (const band of bands) {
    if (applies(band.master) && (!best || rank(band.master) > rank(best.master))) best = band;
  }
  return best;
}

// --- helpers ---------------------------------------------------------------

interface BandBuckets {
  background: Band[];
  reportHeader?: Band;
  /** All page headers (master variants); the matching one is chosen per page. */
  pageHeaders: Band[];
  pageFooters: Band[];
  reportFooter?: Band;
  detail: Band[];
  groupHeaders: Band[];
  groupFooters: Band[];
}

function categorizeBands(bands: Band[], ctx: RenderContext): BandBuckets {
  const buckets: BandBuckets = {
    background: [],
    detail: [],
    groupHeaders: [],
    groupFooters: [],
    pageHeaders: [],
    pageFooters: [],
  };
  for (const band of bands) {
    switch (band.type) {
      case 'background':
      case 'watermark':
        buckets.background.push(band);
        break;
      case 'reportHeader':
        buckets.reportHeader ??= band;
        break;
      case 'pageHeader':
        buckets.pageHeaders.push(band);
        break;
      case 'pageFooter':
        buckets.pageFooters.push(band);
        break;
      case 'reportFooter':
        buckets.reportFooter ??= band;
        break;
      case 'detail':
        buckets.detail.push(band);
        break;
      case 'groupHeader':
        buckets.groupHeaders.push(band);
        break;
      case 'groupFooter':
        buckets.groupFooters.push(band);
        break;
      default:
        ctx.diagnostics.push({
          severity: 'warning',
          message: `Band type '${band.type}' is not yet supported by the pagination MVP (§6); skipped`,
        });
    }
  }
  return buckets;
}

function findDataset(template: PdfTemplate, name: string, ctx: RenderContext) {
  const def = template.datasets.find((d) => d.name === name);
  if (def) return def;
  ctx.diagnostics.push({ severity: 'warning', message: `Dataset '${name}' is not declared` });
  return { name, source: { kind: 'path', path: name } as const };
}

function contentRect(size: Size, margins: EdgeInsets): Rect {
  return {
    x: margins.left,
    y: margins.top,
    width: size.width - margins.left - margins.right,
    height: size.height - margins.top - margins.bottom,
  };
}

function translate(el: LaidOutElement, dx: number, dy: number): LaidOutElement {
  return { ...el, bounds: { ...el.bounds, x: el.bounds.x + dx, y: el.bounds.y + dy } };
}

function layoutBandImpl(
  band: Band,
  scope: Scope,
  leafDeps: LeafDeps,
  tableDeps: TableLayoutDeps,
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[],
  subreports: Map<string, SubreportTemplate>,
): BandLayout {
  const elements: LaidOutElement[] = [];
  let maxBottom = 0;

  for (const el of band.elements) {
    const laid = layoutElement(
      el,
      scope,
      band.locale,
      band.direction,
      leafDeps,
      tableDeps,
      resolveRows,
      subreports,
    );
    for (const le of laid) {
      elements.push(le);
      maxBottom = Math.max(maxBottom, le.bounds.y + le.bounds.height);
    }
  }

  const height = bandHeight(band, maxBottom);
  // A `fixed` band keeps its declared height no matter how tall its content is
  // (and an `auto` band is clamped by `max`), so anything below that line is
  // still painted — on top of whichever band follows. That used to happen in
  // silence; report it instead of drawing a document nobody asked for.
  // Background/watermark bands are exempt: they reserve no flow height by
  // contract and are meant to span the page, so "overflow" means nothing there.
  if (!isPageWideBand(band) && maxBottom > height + EPSILON) {
    warnOnce(
      leafDeps.ctx,
      `Band '${band.id}' is ${round1(height)}pt tall but its content reaches ` +
        `${round1(maxBottom)}pt — the overflow is painted over whatever follows it.`,
    );
  }
  return { elements, height };
}

/** Bands painted across the page rather than flowed into the band stack. */
function isPageWideBand(band: Band): boolean {
  return band.type === 'background' || band.type === 'watermark';
}

/**
 * Push a diagnostic at most once. Bands are laid out per row and the whole
 * document is paginated twice when it carries a ToC, so an un-deduplicated
 * band warning would arrive hundreds of times for one authoring mistake.
 */
function warnOnce(ctx: RenderContext, message: string): void {
  if (ctx.diagnostics.some((d) => d.message === message)) return;
  ctx.diagnostics.push({ severity: 'warning', message });
}

/** One decimal place, so the message stays stable across float noise. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Lay out a single element to its painted pieces. Composite elements expand:
 * tables → cells, lists → repeated items, containers → their own box plus their
 * children (recursively), subreports → an embedded block run against their own
 * data (§5).
 */
function layoutElement(
  el: AnyElement,
  scope: Scope,
  bandLocale: Band['locale'],
  bandDirection: Band['direction'],
  leafDeps: LeafDeps,
  tableDeps: TableLayoutDeps,
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[],
  subreports: Map<string, SubreportTemplate>,
): LaidOutElement[] {
  const locale = resolveLocale(leafDeps.pageLocale, bandLocale, el.locale);
  if (!isVisible(el, scope, locale, leafDeps.ctx)) return [];

  if (el.type === 'table') return layoutTable(el, scope, tableDeps).elements;
  if (el.type === 'crosstab') return layoutCrosstab(el, scope, tableDeps).elements;
  if (el.type === 'list') return layoutList(el, scope, leafDeps, resolveRows).elements;
  if (el.type === 'subreport') {
    return layoutSubreport(el, scope, locale.digits, leafDeps, tableDeps, subreports);
  }
  if (el.type === 'container') {
    const out: LaidOutElement[] = [layoutLeaf(el, scope, bandLocale, bandDirection, leafDeps)];
    for (const child of el.children) {
      for (const piece of layoutElement(
        child,
        scope,
        bandLocale,
        bandDirection,
        leafDeps,
        tableDeps,
        resolveRows,
        subreports,
      )) {
        out.push(translate(piece, el.bounds.x, el.bounds.y));
      }
    }
    return out;
  }
  return [layoutLeaf(el, scope, bandLocale, bandDirection, leafDeps)];
}

/**
 * Embed a registered subreport (§5): resolve its data from the parent scope,
 * lay out its bands as a non-paginated block (report header → detail rows →
 * report footer), and offset the result into the subreport's bounds.
 */
function layoutSubreport(
  el: import('../model/elements').SubreportElement,
  scope: Scope,
  digits: 'latn' | 'persian',
  leafDeps: LeafDeps,
  tableDeps: TableLayoutDeps,
  subreports: Map<string, SubreportTemplate>,
): LaidOutElement[] {
  const sub = subreports.get(el.templateRef);
  if (!sub) {
    leafDeps.ctx.diagnostics.push({
      severity: 'warning',
      message: `Subreport template '${el.templateRef}' is not registered`,
      elementId: el.id,
    });
    return [];
  }
  const value = evaluateExpr(el.dataset.source, scope, leafDeps.ctx, digits, el.id);
  const subData =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { $value: value };
  const subRoot = Scope.create({ data: subData, parameters: leafDeps.ctx.parameters });

  const subResolveRows = (name: string, sc: Scope): Record<string, unknown>[] =>
    resolveDataset(findDatasetIn(sub.datasets ?? [], name, leafDeps.ctx), sc, leafDeps.ctx);
  const subLeaf: LeafDeps = { ...leafDeps, resolveRows: subResolveRows };
  const subTable: TableLayoutDeps = { ...tableDeps, resolveRows: subResolveRows };

  const byType = categorizeBands(sub.bands, leafDeps.ctx);
  const flow = buildBodyFlow(byType, subRoot, leafDeps.ctx, digits, subResolveRows, []);

  const out: LaidOutElement[] = [];
  let cursorY = 0;
  for (const item of flow) {
    const laid = layoutBandImpl(
      item.band,
      item.scope,
      subLeaf,
      subTable,
      subResolveRows,
      subreports,
    );
    for (const le of laid.elements) out.push(translate(le, el.bounds.x, el.bounds.y + cursorY));
    cursorY += laid.height;
  }
  return out;
}

function findDatasetIn(datasets: DatasetDef[], name: string, ctx: RenderContext): DatasetDef {
  const def = datasets.find((d) => d.name === name);
  if (def) return def;
  ctx.diagnostics.push({
    severity: 'warning',
    message: `Subreport dataset '${name}' is not declared`,
  });
  return { name, source: { kind: 'path', path: name } };
}

function bandHeight(band: Band, contentBottom: number): number {
  if (band.height.mode === 'fixed') return band.height.value;
  const min = band.height.min ?? 0;
  const max = band.height.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, contentBottom));
}
