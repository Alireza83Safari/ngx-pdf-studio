/**
 * Format Cloner (Moonshot F2), step 2.3 — turn a page classification into a
 * concrete **sample data object + schema**. The sample values are the runs'
 * *own extracted text*, so a template bound to these paths (F2.4) previews as a
 * faithful copy of the source document out of the box; the schema records each
 * field's `kind` as a formatting hint for later.
 *
 * Paths are flat snake_case keys (from {@link keyFromLabel}); table bodies land
 * under an array key (`items`, then `table_2`…) whose row objects use the
 * detected header cells as column keys, falling back to `col1`, `col2`, …
 */
import {
  detectValueKind,
  keyFromLabel,
  type PageClassification,
  type TableRegion,
  type ValueKind,
} from './classify';
import type { ExtractedPage } from './types';

export interface InferredField {
  path: string;
  kind?: ValueKind;
}

export interface InferredTable {
  /** Array key in the sample data. */
  path: string;
  /** Column keys, in visual order. */
  columns: string[];
}

export interface InferredSchema {
  fields: InferredField[];
  tables: InferredTable[];
}

export interface InferredData {
  /** Ready-to-bind sample data mirroring the source document. */
  data: Record<string, unknown>;
  schema: InferredSchema;
}

/** A table split into header/body with resolved column keys. */
export interface AnalyzedTable {
  columns: string[];
  hasHeader: boolean;
  /** Header cell text indices (empty when no header). */
  headerRow: number[];
  /** Data rows, each as text indices. */
  bodyRows: number[][];
}

/** snake_case column key from a header cell, or a positional fallback. */
function columnKey(text: string, position: number): string {
  return keyFromLabel(text) ?? `col${position + 1}`;
}

/** Sample-data array key for the n-th table (0 → `items`, else `table_<n+1>`). */
export function tablePath(index: number): string {
  return index === 0 ? 'items' : `table_${index + 1}`;
}

/**
 * Split a detected table into header/body and resolve column keys. A first row
 * of pure text (no recognizable values) is treated as a header — table cells
 * are excluded from the field pass, so header-ness is decided by cell shape.
 */
export function analyzeTable(page: ExtractedPage, table: TableRegion): AnalyzedTable {
  const rowsIdx = table.rows;
  const firstRow = rowsIdx[0]!;
  const firstRowHasValue = firstRow.some(
    (idx) => detectValueKind(page.texts[idx]?.text ?? '') !== null,
  );
  const hasHeader = !firstRowHasValue && rowsIdx.length > 1;
  const columns = firstRow.map((idx, k) =>
    hasHeader ? columnKey(page.texts[idx]?.text ?? '', k) : `col${k + 1}`,
  );
  return {
    columns,
    hasHeader,
    headerRow: hasHeader ? firstRow : [],
    bodyRows: hasHeader ? rowsIdx.slice(1) : rowsIdx,
  };
}

/** Build sample data + schema from extracted pages and their classifications. */
export function inferData(pages: ExtractedPage[], classes: PageClassification[]): InferredData {
  const data: Record<string, unknown> = {};
  const fields: InferredField[] = [];
  const tables: InferredTable[] = [];
  let tableCount = 0;

  pages.forEach((page, p) => {
    const cls = classes[p];
    if (!cls) return;

    // scalar fields — sample value is the run's own text (faithful preview)
    for (const t of cls.texts) {
      if (t.role !== 'field' || !t.fieldPath) continue;
      if (t.fieldPath in data) continue; // first occurrence wins (stable)
      data[t.fieldPath] = page.texts[t.index]?.text ?? '';
      fields.push({ path: t.fieldPath, ...(t.kind ? { kind: t.kind } : {}) });
    }

    // tables
    for (const table of cls.tables) {
      const { columns, bodyRows } = analyzeTable(page, table);
      const path = tablePath(tableCount++);
      const rows = bodyRows.map((row) => {
        const obj: Record<string, unknown> = {};
        row.forEach((idx, k) => {
          obj[columns[k] ?? `col${k + 1}`] = page.texts[idx]?.text ?? '';
        });
        return obj;
      });
      data[path] = rows;
      tables.push({ path, columns });
    }
  });

  return { data, schema: { fields, tables } };
}
