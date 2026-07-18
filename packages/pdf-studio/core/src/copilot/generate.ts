/**
 * The copilot pipeline (ROADMAP ۳.۱): prompt → LLM → **validate → repair**.
 *
 * Why this is uniquely safe here: a template is pure, zod-validated JSON and
 * every expression runs in the sandboxed engine — so model output either
 * validates or is bounced back with the exact validation issues for a repair
 * round. Nothing unvalidated can ever reach the canvas or a PDF.
 */
import { importTemplate } from '../serialization/serialize';
import { resolvePageSize } from '../layout';
import type { PdfTemplate } from '../model/template';
import type { CopilotMessage, CopilotProvider } from './provider';

/**
 * A complete, valid template the model sees as a worked example (few-shot).
 * Validated by importTemplate in the test suite, so what we teach can never
 * drift out of sync with the schema.
 */
const V = 'Vazirmatn';
const INK = { space: 'rgb', r: 15, g: 23, b: 42 } as const;
const BLUE = { space: 'rgb', r: 37, g: 99, b: 235 } as const;
const MUTED = { space: 'rgb', r: 100, g: 116, b: 139 } as const;

export const TEMPLATE_EXAMPLE = {
  schemaVersion: '1.0.0',
  metadata: { name: 'فاکتور فروش' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
    direction: 'rtl',
    locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
    unit: 'pt',
  },
  styles: [
    { id: 'cell', name: 'سلول', typography: { fontFamily: V, fontSize: 10, color: INK } },
    {
      id: 'cellHead',
      name: 'سرستون',
      typography: { fontFamily: V, fontSize: 10, fontWeight: 'bold', color: INK },
      box: { fill: { color: { space: 'rgb', r: 241, g: 245, b: 249 } } },
    },
  ],
  datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
  parameters: [],
  bands: [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 760 },
      elements: [
        {
          id: 't-title',
          type: 'staticText',
          bounds: { x: 0, y: 0, width: 240, height: 30 },
          zIndex: 1,
          text: 'فاکتور فروش',
          typography: { fontFamily: V, fontSize: 22, fontWeight: 'bold', color: BLUE },
        },
        {
          id: 'f-co',
          type: 'dataField',
          bounds: { x: 0, y: 38, width: 260, height: 16 },
          zIndex: 1,
          value: { source: 'company.name' },
          typography: { fontFamily: V, fontSize: 12, fontWeight: 'bold', color: INK },
        },
        {
          id: 'qr',
          type: 'qrcode',
          bounds: { x: 453, y: 0, width: 70, height: 70 },
          zIndex: 1,
          value: { source: 'invoice.number' },
        },
        {
          id: 'f-date',
          type: 'pageField',
          field: 'currentDate',
          bounds: { x: 300, y: 40, width: 150, height: 16 },
          zIndex: 1,
          typography: { fontFamily: V, fontSize: 11, color: MUTED },
        },
        {
          id: 'ln1',
          type: 'line',
          bounds: { x: 0, y: 88, width: 523, height: 2 },
          zIndex: 1,
          stroke: { width: 2, color: BLUE },
        },
        {
          id: 'f-cust',
          type: 'dataField',
          bounds: { x: 0, y: 100, width: 300, height: 18 },
          zIndex: 1,
          value: { source: `'خریدار: ' + customer.name` },
          typography: { fontFamily: V, fontSize: 12, fontWeight: 'bold', color: INK },
        },
        {
          id: 'tbl',
          type: 'table',
          bounds: { x: 0, y: 132, width: 523, height: 180 },
          zIndex: 1,
          dataset: 'items',
          rowStripeStyleId: 'cell',
          columns: [
            {
              id: 'c-name',
              width: { kind: 'percent', value: 46 },
              header: { text: 'شرح کالا', styleId: 'cellHead' },
              detail: { content: { source: 'name' }, styleId: 'cell' },
            },
            {
              id: 'c-qty',
              width: { kind: 'percent', value: 14 },
              header: { text: 'تعداد', styleId: 'cellHead' },
              detail: { content: { source: 'qty' }, styleId: 'cell' },
            },
            {
              id: 'c-price',
              width: { kind: 'percent', value: 20 },
              header: { text: 'فی (ریال)', styleId: 'cellHead' },
              detail: { content: { source: 'price' }, styleId: 'cell' },
            },
            {
              id: 'c-sum',
              width: { kind: 'percent', value: 20 },
              header: { text: 'جمع (ریال)', styleId: 'cellHead' },
              detail: { content: { source: 'qty * price' }, styleId: 'cell' },
              footer: { aggregate: 'sum', styleId: 'cellHead' },
            },
          ],
        },
        {
          id: 'f-total',
          type: 'dataField',
          bounds: { x: 300, y: 324, width: 223, height: 20 },
          zIndex: 1,
          value: { source: `'جمع کل: ' + sum(items, qty * price)` },
          typography: {
            fontFamily: V,
            fontSize: 13,
            fontWeight: 'bold',
            color: BLUE,
            align: 'end',
          },
        },
        {
          id: 'f-words',
          type: 'dataField',
          bounds: { x: 0, y: 350, width: 523, height: 18 },
          zIndex: 1,
          value: { source: `'مبلغ به حروف: ' + toWords(sum(items, qty * price), 'rial')` },
          typography: { fontFamily: V, fontSize: 10, color: MUTED },
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

/** Compact, self-contained contract the model must follow. */
export const TEMPLATE_CONTRACT = `You are the template designer for ngx-pdf-studio, a Persian/RTL-first PDF report engine.
Given a request, you output ONE complete, valid template as a single JSON object — no prose, no markdown fences.

WHAT A TEMPLATE IS
A page description plus data bindings. Data is NOT in the template; the template references it by expression
(e.g. customer.name), and the engine fills it in at render time. So design the LAYOUT and BIND to the field names
you see in the sample data.

Template shape:
{
  "schemaVersion": "1.0.0",
  "metadata": { "name": string },
  "page": { "size": "A4"|"A5"|"A3"|"Letter"|"Legal"|{"width":pt,"height":pt},
            "orientation": "portrait"|"landscape",
            "margins": {"top":pt,"right":pt,"bottom":pt,"left":pt},
            "direction": "rtl"|"ltr",
            "locale": {"language":"fa","digits":"persian","calendar":"jalali"} (or en/latn/gregorian),
            "unit": "pt" },
  "styles": [{"id":string,"name":string,"typography":{...},"box":{"fill":{"color":{...}}}?}],
  "datasets": [{"name":string,"source":{"kind":"path","path":string}}],
  "parameters": [],
  "bands": [{ "id": string, "type": "reportHeader",
              "height": {"mode":"fixed","value":pt} | {"mode":"auto"},
              "elements": [Element] }],
  "resources": { "fonts": [], "images": [] }
}

LAYOUT MODEL — read this carefully:
- Put ALL elements in ONE band of type "reportHeader" with a fixed height. Do not spread content across
  multiple bands.
- COORDINATES ARE STANDARD TOP-LEFT: x=0 is the LEFT edge and x grows to the RIGHT; y=0 is the TOP and y
  grows DOWN. Do NOT mirror positions for RTL yourself — the engine right-aligns Persian text and orders
  table columns right-to-left automatically. You only place plain top-left boxes.
- A4 portrait content area is 523pt wide and ~770pt tall (after 36pt margins).
- HARD RULE, never break it: every element must satisfy 0 ≤ x AND x + width ≤ 523, and 0 ≤ y AND
  y + height ≤ band height. Nothing may run off the page. A full-width element is {x:0, width:523}.
- Stack rows top-to-bottom by increasing y with ~8–15pt gaps; never overlap. Keep it COMPACT and
  top-anchored: put the total/summary ~12–20pt directly below the table, and set the band height to
  roughly the bottom of your last element — do NOT leave a large empty vertical gap.
- colors are {"space":"rgb","r":0-255,"g":0-255,"b":0-255}.

Every Element needs: id (kebab-case, unique), type, bounds, zIndex (1). Element types and their extra fields:
- staticText: text (literal string); typography {fontFamily:"Vazirmatn",fontSize,fontWeight:"bold"?,color,align:"start"|"center"|"end"|"justify"}
- dataField: value {source: EXPRESSION}; optional format {kind:"money"|"number"|"percent"|"date"}; same typography
- pageField: field "currentDate"|"page"|"pageCount"; optional format; typography — USE THIS for dates and page numbers
- table: dataset (name), rowStripeStyleId?, columns [{id, width:{kind:"percent",value}, header:{text,styleId?}, detail:{content:{source:EXPR},styleId?}, footer:{aggregate:"sum"|"avg"|"count"|"min"|"max",styleId?}?}]
- chart: chartKind "column"|"bar"|"line"|"pie"|"donut"|"area"|"stackedColumn", dataset, categories {source:EXPR}, series [{name,values:{source:EXPR}}], showLegend?
- barcode: symbology "code128"|"code39"|"ean13", value {source:EXPR}, showText true
- qrcode: value {source:EXPR}
- image: source {source: "'https://…'"} (a quoted URL string expression), fit "contain"
- line: stroke {width,color}
- rectangle / ellipse: optional box {fill:{color},border:{all:{width,color}}}

EXPRESSIONS (sandboxed, used anywhere a "source" appears):
- field paths: customer.name, items[0].qty
- arithmetic: qty * price
- aggregates over a dataset: sum(items, qty * price), avg(...), count(...), min(...), max(...)
- string LITERALS in SINGLE quotes: 'مبلغ کل'
- concatenation with +: 'خریدار: ' + customer.name
- conditionals: total > 1000000 ? 'ویژه' : 'عادی'
- toWords(n, 'rial'): Persian amount-in-words
Never put a bare literal string where an expression is expected — wrap it in single quotes.

RULES:
- Persian documents: direction "rtl", locale fa/persian/jalali, fontFamily "Vazirmatn" on EVERY text/field.
- Define table cell styles in "styles" (a normal "cell" and a bold, shaded "cellHead") and reference them by
  styleId on header/detail/footer — do not leave tables unstyled.
- Bind fields to the ACTUAL names in the provided sample data. If a document has line items, drive the table
  from the array (a dataset with source path to that array).
- Give the document a title, sensible spacing, and a footer note where it fits. Make it look finished, not sparse.
- Do NOT invent element types or fields not listed above. Keep ids kebab-case and unique.
- When asked to MODIFY a template, return the FULL updated template JSON, preserving unrelated parts.

COMPLETE EXAMPLE (an invoice — study its structure, spacing, styles, table, and expressions, then adapt):
${JSON.stringify(TEMPLATE_EXAMPLE)}`;

export interface GenerateOptions {
  /** The user's request, in any language. */
  prompt: string;
  /** Current template — include when modifying instead of creating. */
  currentTemplate?: PdfTemplate;
  /** Sample data the template should bind to. */
  sampleData?: unknown;
  provider: CopilotProvider;
  /** Extra validate→repair rounds after the first attempt (default 2). */
  maxRepairs?: number;
}

export type GenerateResult =
  | { success: true; template: PdfTemplate; attempts: number }
  | { success: false; error: string; attempts: number };

/**
 * Elements that fall outside the page content area. This is the #1 way LLM
 * output looks broken — a table or field whose x+width exceeds the content
 * width gets clipped at the right margin. importTemplate accepts it (it's
 * schema-valid), so we check geometry separately and feed violations back as
 * a repair round, same as a validation failure.
 */
export function outOfBoundsIssues(t: PdfTemplate): string[] {
  const size = resolvePageSize(t.page.size, t.page.orientation);
  const m = t.page.margins;
  const contentW = Math.round(size.width - m.left - m.right);
  const contentH = Math.round(size.height - m.top - m.bottom);
  const TOL = 1; // pt — ignore sub-point rounding
  const issues: string[] = [];
  for (const band of t.bands) {
    const bandH = band.height.mode === 'fixed' ? band.height.value : Infinity;
    // A band that spans the full page content height is a background/hero band
    // where full-bleed decoration (a coloured edge stripe reaching the paper
    // edge) is legitimate design, not an LLM mistake. Only there do we allow an
    // element to sit inside the margin ring; inner bands stay strict.
    const fullPage = Number.isFinite(bandH) && Math.abs((bandH as number) - contentH) <= TOL;
    const bleedL = fullPage ? m.left : 0;
    const bleedT = fullPage ? m.top : 0;
    const bleedR = fullPage ? m.right : 0;
    const bleedB = fullPage ? m.bottom : 0;
    for (const el of band.elements) {
      const b = (el as { bounds?: { x: number; y: number; width: number; height: number } }).bounds;
      if (!b) continue;
      if (b.x < -bleedL - TOL)
        issues.push(`element "${el.id}" has negative x (${Math.round(b.x)})`);
      if (b.y < -bleedT - TOL)
        issues.push(`element "${el.id}" has negative y (${Math.round(b.y)})`);
      if (b.x + b.width > contentW + bleedR + TOL)
        issues.push(
          `element "${el.id}" runs off the right edge: x+width=${Math.round(
            b.x + b.width,
          )} exceeds content width ${contentW}`,
        );
      if (b.y + b.height > bandH + bleedB + TOL)
        issues.push(
          `element "${el.id}" runs below the band: y+height=${Math.round(
            b.y + b.height,
          )} exceeds band height ${bandH}`,
        );
    }
  }
  return issues.slice(0, 8);
}

/** Pull the first JSON object out of a model reply (fences tolerated). */
export function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? (fenced[1] as string) : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/** Generate (or modify) a template through the validate→repair loop. */
export async function generateTemplate(options: GenerateOptions): Promise<GenerateResult> {
  const maxRepairs = options.maxRepairs ?? 2;

  let user = options.prompt.trim();
  if (options.sampleData !== undefined) {
    user += `\n\nSample data the template binds to:\n${JSON.stringify(options.sampleData)}`;
  }
  if (options.currentTemplate) {
    user += `\n\nCurrent template (modify this, return the full result):\n${JSON.stringify(
      options.currentTemplate,
    )}`;
  }

  const messages: CopilotMessage[] = [{ role: 'user', content: user }];
  let attempts = 0;
  let lastError = 'no attempts made';

  while (attempts <= maxRepairs) {
    attempts += 1;
    let reply: string;
    try {
      reply = await options.provider.complete(TEMPLATE_CONTRACT, messages);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        attempts,
      };
    }

    const json = extractJson(reply);
    if (json) {
      const res = importTemplate(json);
      if (res.success) {
        // schema-valid — now check geometry; overflow gets one repair round too
        const bounds = outOfBoundsIssues(res.value);
        if (bounds.length === 0 || attempts > maxRepairs) {
          return { success: true, template: res.value, attempts };
        }
        lastError = bounds.join('\n');
        messages.push({ role: 'assistant', content: reply });
        messages.push({
          role: 'user',
          content: `The template is valid but some elements fall OUTSIDE the page. Move/resize them so every element satisfies 0 ≤ x and x+width ≤ content width, and 0 ≤ y and y+height ≤ band height. Return the FULL corrected JSON only:\n${lastError}`,
        });
        continue;
      }
      lastError = res.issues
        .slice(0, 8)
        .map((i) => `${i.path}: ${i.message}`)
        .join('\n');
    } else {
      lastError = 'reply contained no JSON object';
    }

    // feed the exact failures back for a repair round
    messages.push({ role: 'assistant', content: reply });
    messages.push({
      role: 'user',
      content: `That template failed validation. Fix these issues and return the FULL corrected JSON only:\n${lastError}`,
    });
  }

  return { success: false, error: lastError, attempts };
}
