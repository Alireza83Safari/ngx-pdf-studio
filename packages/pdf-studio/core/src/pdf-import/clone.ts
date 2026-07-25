/**
 * Format Cloner (Moonshot F2), step 2.4 — assemble a **fully bound, editable
 * template** from a dropped PDF. It ties the pipeline together: extract →
 * classify (heuristic, optionally AI-escalated) → infer sample data → bind.
 *
 * It reuses {@link pdfContentToTemplate} for geometry (page size, rectangles,
 * lines, and one text element per run) and then rebinds:
 *  - runs the heuristic flagged as **fields** become `dataField`s bound to the
 *    inferred path;
 *  - **table** regions collapse into a single bound `table` element (columns →
 *    detail expressions, header row → column headers) with a declared dataset;
 *  - everything else stays literal `staticText`.
 *
 * The returned `inferredData` mirrors the source, so the template previews as a
 * faithful copy immediately. The heuristic path needs no API key (F2 acceptance);
 * pass a `classifier` to escalate ambiguous runs.
 */
import type { AnyElement, TableColumn } from '../model/elements';
import type { DatasetDef } from '../model/dataset';
import type { PdfTemplate } from '../model/template';
import type { CopilotProvider } from '../copilot/provider';
import { classifyPage, type PageClassification } from './classify';
import { classifyPageWithAi, type AiClassifyOptions } from './classify-ai';
import { pdfContentToTemplate, type PdfImportOptions } from './convert';
import { analyzeTable, inferData, tablePath, type InferredSchema } from './infer';
import type { ExtractedPage } from './types';

export interface CloneFormatOptions extends PdfImportOptions {
  /** Optional AI provider to escalate ambiguous runs (F2.2); omit for keyless. */
  classifier?: CopilotProvider;
  /** Passed through to {@link classifyPageWithAi} when a classifier is given. */
  aiOptions?: AiClassifyOptions;
}

export interface CloneFormatResult {
  template: PdfTemplate;
  /** Ready-to-bind sample data mirroring the source document. */
  inferredData: Record<string, unknown>;
  schema: InferredSchema;
  warnings: string[];
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** Classify every page, using the AI provider when one is supplied. */
async function classifyAll(
  pages: ExtractedPage[],
  options: CloneFormatOptions,
): Promise<PageClassification[]> {
  if (!options.classifier) return pages.map((p) => classifyPage(p));
  const classifier = options.classifier;
  return Promise.all(pages.map((p) => classifyPageWithAi(p, classifier, options.aiOptions ?? {})));
}

/** Build one bound `table` element from a detected region, using laid-out bounds. */
function buildTable(
  page: ExtractedPage,
  region: PageClassification['tables'][number],
  textEls: Extract<AnyElement, { type: 'staticText' }>[],
  path: string,
  id: string,
): AnyElement {
  const { columns, hasHeader, headerRow, bodyRows } = analyzeTable(page, region);
  const cells = region.rows.flat();
  const xs = cells.map((k) => textEls[k]!.bounds.x);
  const rights = cells.map((k) => textEls[k]!.bounds.x + textEls[k]!.bounds.width);
  const tops = cells.map((k) => textEls[k]!.bounds.y);
  const bottoms = cells.map((k) => textEls[k]!.bounds.y + textEls[k]!.bounds.height);
  const x = Math.min(...xs);
  const right = Math.max(...rights);
  const y = Math.min(...tops);
  const bottom = Math.max(...bottoms);
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);

  const colRow = (hasHeader ? headerRow : bodyRows[0]) ?? region.rows[0]!;
  const colXs = colRow.map((k) => textEls[k]!.bounds.x);
  const cols: TableColumn[] = columns.map((key, c) => {
    const colW = (colXs[c + 1] ?? right) - (colXs[c] ?? x);
    const col: TableColumn = {
      id: `c-${path}-${c}`,
      width: { kind: 'percent', value: round((Math.max(1, colW) / width) * 100) },
      detail: { content: { source: key } },
    };
    if (hasHeader) col.header = { text: page.texts[headerRow[c]!]?.text ?? key };
    return col;
  });

  return {
    id,
    type: 'table',
    bounds: { x: round(x), y: round(y), width: round(width), height: round(height) },
    zIndex: 2,
    dataset: path,
    columns: cols,
    ...(hasHeader ? { repeatHeader: true } : {}),
  } as AnyElement;
}

/** Extract → classify → infer → bind a dropped PDF into an editable template. */
export async function cloneFormat(
  pages: ExtractedPage[],
  options: CloneFormatOptions = {},
): Promise<CloneFormatResult> {
  const classes = await classifyAll(pages, options);
  const { data, schema } = inferData(pages, classes);

  const importOpts: PdfImportOptions = { name: options.name ?? 'Cloned format' };
  if (options.maxGraphicsPerPage !== undefined)
    importOpts.maxGraphicsPerPage = options.maxGraphicsPerPage;
  if (options.minMarkSize !== undefined) importOpts.minMarkSize = options.minMarkSize;
  const { template, warnings } = pdfContentToTemplate(pages, importOpts);

  const datasets: DatasetDef[] = [];
  let tableCount = 0;

  template.bands.forEach((band, p) => {
    const page = pages[p];
    const cls = classes[p];
    if (!page || !cls) return;

    const graphics = band.elements.filter((e) => e.type !== 'staticText');
    const textEls = band.elements.filter(
      (e): e is Extract<AnyElement, { type: 'staticText' }> => e.type === 'staticText',
    );

    const inTable = new Set<number>();
    for (const t of cls.tables) for (const r of t.rows) for (const k of r) inTable.add(k);

    const rebound: AnyElement[] = [];
    for (let k = 0; k < textEls.length; k++) {
      if (inTable.has(k)) continue; // table cells are replaced by one table element
      const el = textEls[k]!;
      const c = cls.texts[k];
      if (c && c.role === 'field' && c.fieldPath) {
        const df: AnyElement = {
          id: el.id,
          type: 'dataField',
          bounds: el.bounds,
          zIndex: el.zIndex,
          value: { source: c.fieldPath },
          ...(el.direction ? { direction: el.direction } : {}),
          ...(el.typography ? { typography: el.typography } : {}),
        } as AnyElement;
        rebound.push(df);
      } else {
        rebound.push(el);
      }
    }

    for (const region of cls.tables) {
      const path = tablePath(tableCount++);
      rebound.push(buildTable(page, region, textEls, path, `table-${path}`));
      datasets.push({ name: path, source: { kind: 'path', path } });
    }

    band.elements = [...graphics, ...rebound];
  });

  template.datasets = datasets;

  return { template, inferredData: data, schema, warnings };
}
