/**
 * Format Cloner (Moonshot F2), step 2.1 — the **offline heuristic** that guesses
 * which extracted text runs are fixed boilerplate ("static") and which are data
 * ("field"), without any AI. It is cheap, deterministic, and works with no API
 * key, matching the project's "free/local provider" ethos; ambiguous runs are
 * later escalated to an AI classifier (F2.2) and turned into real bindings (F2.4).
 *
 * Three signals, cheapest first:
 *  1. **value kind** — a run whose text matches a date / currency / number /
 *     percent / email / phone / IBAN pattern is almost certainly data.
 *  2. **label:value** — a run ending in a colon is a fixed label; the run
 *     adjacent to it in reading order is its value (a field), even when that
 *     value has no obvious kind (e.g. a customer name).
 *  3. **repeating rows** — rows that share column x-positions across several
 *     lines are a table body; their cells are per-row fields.
 *
 * All inputs are latinized first ({@link toLatinDigits}) so Persian numerals are
 * recognized identically to ASCII.
 */
import { toLatinDigits } from '../expression/digits';
import type { ExtractedPage, ExtractedText } from './types';

export type ValueKind = 'date' | 'currency' | 'number' | 'percent' | 'email' | 'phone' | 'iban';
export type TextRole = 'static' | 'label' | 'field';

export interface TextClassification {
  /** Index into the page's `texts` array. */
  index: number;
  role: TextRole;
  /** Value kind, when one was recognized (fields and labelled values). */
  kind?: ValueKind;
  /** Suggested binding path, e.g. `invoice_number` or `amount1` (fields only). */
  fieldPath?: string;
  /** For a label, the index of the value run it introduces. */
  valueIndex?: number;
}

export interface DetectedColumn {
  /** Left edge of the column cluster, pt (PDF space). */
  x: number;
}

export interface TableRegion {
  /** Column x-clusters shared across the rows. */
  columns: DetectedColumn[];
  /** Each row as the text indices of its cells, top row first. */
  rows: number[][];
}

export interface PageClassification {
  texts: TextClassification[];
  tables: TableRegion[];
}

const CURRENCY_WORD = /(ریال|تومان|﷼|rial|irr|usd|eur|gbp)/i;
const CURRENCY_SYMBOL = /[$€£]/;
const GROUPED_NUMBER = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const PERCENT = /^-?\d+(\.\d+)?\s*[%٪]$/;
const DATE_YMD = /^\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}$/;
const DATE_DMY = /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IBAN_IR = /^IR\d{24}$/i;
const IR_MOBILE = /^(0|\+98|0098)9\d{9}$/;
const GENERIC_PHONE = /^\+?\d[\d\s\-()]{6,}\d$/;
const LABEL_SUFFIX = /[:：]\s*$/;

/** Classify a single run's text as a data value, or `null` if it is not one. */
export function detectValueKind(raw: string): ValueKind | null {
  const s = toLatinDigits(raw).trim();
  if (!s) return null;
  if (EMAIL.test(s)) return 'email';
  if (IBAN_IR.test(s.replace(/\s/g, ''))) return 'iban';
  if (PERCENT.test(s)) return 'percent';
  if (DATE_YMD.test(s) || DATE_DMY.test(s)) return 'date';
  const compact = s.replace(/[\s\-()]/g, '');
  if (IR_MOBILE.test(compact) || GENERIC_PHONE.test(s)) return 'phone';
  const numeric = s.replace(CURRENCY_WORD, '').replace(CURRENCY_SYMBOL, '').trim();
  const hasCurrency = CURRENCY_WORD.test(s) || CURRENCY_SYMBOL.test(s);
  if (GROUPED_NUMBER.test(numeric) || PLAIN_NUMBER.test(numeric)) {
    return hasCurrency ? 'currency' : GROUPED_NUMBER.test(numeric) ? 'currency' : 'number';
  }
  if (hasCurrency) return 'currency';
  return null;
}

/** True when a run reads as a field label (ends with a colon). */
export function looksLikeLabel(raw: string): boolean {
  return LABEL_SUFFIX.test(raw) && toLatinDigits(raw).replace(LABEL_SUFFIX, '').trim().length > 0;
}

/** ASCII-safe binding key from a label; `null` when nothing survives (e.g. all-Persian). */
export function keyFromLabel(raw: string): string | null {
  const key = toLatinDigits(raw)
    .replace(LABEL_SUFFIX, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key.length ? key : null;
}

/** Group text indices into visual rows by baseline proximity (top row first). */
function groupRows(texts: ExtractedText[]): number[][] {
  const order = texts.map((_, i) => i).sort((a, b) => texts[b]!.y - texts[a]!.y);
  const rows: number[][] = [];
  let current: number[] = [];
  let rowY = Number.NaN;
  for (const i of order) {
    const t = texts[i]!;
    const tol = Math.max(2, t.fontSize * 0.6);
    if (current.length === 0 || Math.abs(t.y - rowY) <= tol) {
      current.push(i);
      rowY = Number.isNaN(rowY) ? t.y : rowY;
    } else {
      rows.push(current);
      current = [i];
      rowY = t.y;
    }
  }
  if (current.length) rows.push(current);
  // left-to-right within each row for stable column reasoning
  for (const row of rows) row.sort((a, b) => texts[a]!.x - texts[b]!.x);
  return rows;
}

/**
 * Detect table regions: runs of ≥2 consecutive rows that each have the same
 * number of cells (≥2) and whose cell x-positions line up into shared columns.
 * Rows containing a cell already claimed by label:value pairing are treated as
 * breaks — a colon form is not a table even when its columns happen to align.
 */
function detectTables(
  texts: ExtractedText[],
  rows: number[][],
  claimed: ReadonlySet<number>,
): TableRegion[] {
  const eligible = (row: number[]): boolean =>
    row.length >= 2 && row.every((idx) => !claimed.has(idx));
  const tables: TableRegion[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (!eligible(row)) {
      i++;
      continue;
    }
    const cols = row.map((idx) => texts[idx]!.x);
    const tol = Math.max(6, (texts[row[0]!]!.fontSize || 10) * 1.5);
    const block = [row];
    let j = i + 1;
    while (j < rows.length) {
      const next = rows[j]!;
      if (!eligible(next) || next.length !== cols.length) break;
      const aligned = next.every((idx, k) => Math.abs(texts[idx]!.x - cols[k]!) <= tol);
      if (!aligned) break;
      block.push(next);
      j++;
    }
    if (block.length >= 2) {
      tables.push({ columns: cols.map((x) => ({ x })), rows: block });
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

/** Run all three heuristics over one extracted page. */
export function classifyPage(page: ExtractedPage): PageClassification {
  const texts = page.texts;
  const rows = groupRows(texts);

  const cls: TextClassification[] = texts.map((_, index) => ({ index, role: 'static' }));
  let counter = 0;
  const nextPath = (kind: ValueKind | null): string => `${kind ?? 'field'}${++counter}`;

  // pass 1: label:value pairs (form fields). Runs first so a two-column colon
  // form is never mistaken for a table.
  const claimed = new Set<number>();
  for (const row of rows) {
    for (let p = 0; p < row.length; p++) {
      const idx = row[p]!;
      if (!looksLikeLabel(texts[idx]!.text)) continue;
      // value is the adjacent run in reading order: for RTL the run to the
      // left (smaller x), for LTR the run to the right (larger x).
      const valuePos = texts[idx]!.dir === 'rtl' ? p - 1 : p + 1;
      const valueIdx = row[valuePos];
      if (valueIdx === undefined || looksLikeLabel(texts[valueIdx]!.text)) continue;
      cls[idx]!.role = 'label';
      cls[idx]!.valueIndex = valueIdx;
      const kind = detectValueKind(texts[valueIdx]!.text);
      cls[valueIdx]!.role = 'field';
      if (kind) cls[valueIdx]!.kind = kind;
      cls[valueIdx]!.fieldPath = keyFromLabel(texts[idx]!.text) ?? nextPath(kind);
      claimed.add(idx).add(valueIdx);
    }
  }

  // pass 2: tables over rows not consumed by the form pass
  const tables = detectTables(texts, rows, claimed);
  const inTable = new Set<number>();
  for (const t of tables) for (const r of t.rows) for (const idx of r) inTable.add(idx);

  // pass 3: standalone values not claimed by a label or a table
  for (let index = 0; index < texts.length; index++) {
    if (cls[index]!.role !== 'static' || inTable.has(index)) continue;
    const kind = detectValueKind(texts[index]!.text);
    if (!kind) continue;
    cls[index]!.role = 'field';
    cls[index]!.kind = kind;
    cls[index]!.fieldPath = nextPath(kind);
  }

  return { texts: cls, tables };
}
