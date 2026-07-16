/**
 * The copilot pipeline (ROADMAP ۳.۱): prompt → LLM → **validate → repair**.
 *
 * Why this is uniquely safe here: a template is pure, zod-validated JSON and
 * every expression runs in the sandboxed engine — so model output either
 * validates or is bounced back with the exact validation issues for a repair
 * round. Nothing unvalidated can ever reach the canvas or a PDF.
 */
import { importTemplate } from '../serialization/serialize';
import type { PdfTemplate } from '../model/template';
import type { CopilotMessage, CopilotProvider } from './provider';

/** Compact, self-contained contract the model must follow. */
export const TEMPLATE_CONTRACT = `You generate templates for ngx-pdf-studio, a Persian/RTL-first PDF engine.
Reply with ONE JSON object only (no prose, no markdown fences).

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
  "styles": [], "datasets": [{"name":string,"source":{"kind":"path","path":string}}], "parameters": [],
  "bands": [{ "id": string, "type": "reportHeader"|"detail"|"pageFooter",
              "height": {"mode":"fixed","value":pt} | {"mode":"auto"},
              "elements": [Element] }],
  "resources": { "fonts": [], "images": [] }
}

Every Element needs: id (unique), type, bounds {x,y,width,height} (pt, relative to the band,
content width for A4 with 36pt margins is 523), zIndex (1).
Element types and their extra fields:
- staticText: text; typography {fontFamily:"Vazirmatn",fontSize,fontWeight:"bold"?,color:{space:"rgb",r,g,b},align:"start"|"center"|"end"|"justify"}
- dataField: value {source: expression}; optional format {kind:"money"|"number"|"percent"|"date"}; same typography
- table: dataset (name), columns [{id,width:{kind:"percent",value},header:{text,styleId?},detail:{content:{source},styleId?},footer:{aggregate:"sum"}?}]
- chart: chartKind "column"|"bar"|"line"|"pie"|"donut"|"area"|"stackedColumn", dataset, categories {source}, series [{name,values:{source}}]
- barcode: symbology "code128"|"code39"|"ean13", value {source}, showText true
- qrcode: value {source}
- image: source {source: "'https://…'"}, fit "contain"
- line: stroke {width,color}; rectangle/ellipse: box {fill:{color},border:{all:{width,color}}}
- toc: automatic table of contents from bookmarks

Expressions (sandboxed): field paths (customer.name, items[0].qty), arithmetic (qty * price),
aggregates (sum(items, qty * price)), strings in single quotes ('متن'), concatenation with +,
conditionals (a > b ? 'x' : 'y'), toWords(n, 'rial') for Persian amount-in-words.
String literals inside expressions MUST use single quotes.

Rules:
- Persian documents: direction rtl, locale fa/persian/jalali, fontFamily "Vazirmatn" on ALL text.
- Keep ids kebab-case and unique. Do not invent element types or fields.
- Position elements so they do not overlap; leave breathing room.
- When the user asks to MODIFY a template, return the FULL updated template JSON.`;

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
      if (res.success) return { success: true, template: res.value, attempts };
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
