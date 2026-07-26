/**
 * Format Cloner (Moonshot F2), step 2.2 — **AI escalation** for the offline
 * classifier. The heuristic ({@link classifyPage}) is cheap and keyless but
 * misses data with no numeric/colon tell (a bare customer name, an address).
 * When a caller supplies a {@link CopilotProvider}, we send the page's runs —
 * text + coordinates + the heuristic's own guess — under a strict JSON contract
 * and let the model re-label the ambiguous ones.
 *
 * Safety / graceful degradation: the AI can only *refine* a classification, it
 * never produces a template directly. Any failure — network, malformed JSON,
 * out-of-range indices — falls back to the heuristic result, so the keyless
 * path in {@link classifyPage} always works (F2 acceptance).
 */
import { extractJson } from '../copilot/generate';
import type { CopilotProvider } from '../copilot/provider';
import { classifyPage, type PageClassification, type TextRole, type ValueKind } from './classify';
import type { ExtractedPage } from './types';

const ROLES: ReadonlySet<string> = new Set(['static', 'label', 'field']);
const KINDS: ReadonlySet<string> = new Set([
  'date',
  'currency',
  'number',
  'percent',
  'email',
  'phone',
  'iban',
]);

export const CLASSIFY_CONTRACT = `You label text runs extracted from a form/invoice PDF so it can be turned into a reusable template.

Each segment has: i (index), text, x, y (PDF points, y grows up), and guess (the heuristic's role).
Decide, per segment, one role:
- "static": fixed boilerplate that is the SAME on every printed copy (titles, column headers, labels, terms).
- "label": a caption that names a nearby value (usually ends with a colon).
- "field": data that CHANGES per document (names, numbers, dates, amounts, addresses, ids).

For each "field", add:
- fieldPath: a short snake_case ascii key (e.g. "customer_name", "total_amount"); reuse the label's meaning when there is one.
- kind (optional): one of date | currency | number | percent | email | phone | iban.

Reply with ONLY JSON: {"segments":[{"i":0,"role":"field","fieldPath":"customer_name"}, ...]}.
Include only segments whose role you are changing or enriching; omit the rest.`;

interface AiSegment {
  i: number;
  role: TextRole;
  fieldPath?: string;
  kind?: ValueKind;
}

export interface AiClassifyOptions {
  /**
   * Only let the model override runs the heuristic left as `static` (default
   * true) — it catches missed fields without second-guessing confident
   * regex/label decisions. Set false to let the model re-label everything.
   */
  onlyAmbiguous?: boolean;
}

function parseSegments(reply: string, count: number): AiSegment[] | null {
  const json = extractJson(reply);
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const list = (data as { segments?: unknown }).segments;
  if (!Array.isArray(list)) return null;
  const out: AiSegment[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const seg = raw as Record<string, unknown>;
    const i = seg['i'];
    const role = seg['role'];
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= count) continue;
    if (typeof role !== 'string' || !ROLES.has(role)) continue;
    const item: AiSegment = { i, role: role as TextRole };
    if (typeof seg['fieldPath'] === 'string' && seg['fieldPath']) item.fieldPath = seg['fieldPath'];
    if (typeof seg['kind'] === 'string' && KINDS.has(seg['kind']))
      item.kind = seg['kind'] as ValueKind;
    out.push(item);
  }
  return out;
}

function merge(
  base: PageClassification,
  ai: AiSegment[],
  onlyAmbiguous: boolean,
): PageClassification {
  const texts = base.texts.map((t) => ({ ...t }));
  for (const seg of ai) {
    const cur = texts[seg.i]!;
    if (onlyAmbiguous && cur.role !== 'static') continue;
    cur.role = seg.role;
    if (seg.role === 'field') {
      if (seg.fieldPath) cur.fieldPath = seg.fieldPath;
      if (seg.kind) cur.kind = seg.kind;
    } else {
      // demoted away from a value: drop stale field metadata
      delete cur.fieldPath;
      delete cur.kind;
      delete cur.valueIndex;
    }
  }
  return { texts, tables: base.tables };
}

/**
 * Classify a page with an AI provider layered over the heuristic. Never throws
 * for provider/parse problems — it returns the heuristic result instead.
 */
export async function classifyPageWithAi(
  page: ExtractedPage,
  classifier: CopilotProvider,
  options: AiClassifyOptions = {},
): Promise<PageClassification> {
  const base = classifyPage(page);
  if (page.texts.length === 0) return base;

  const segments = page.texts.map((t, i) => ({
    i,
    text: t.text,
    x: Math.round(t.x),
    y: Math.round(t.y),
    guess: base.texts[i]!.role,
  }));
  const user = JSON.stringify({
    pageWidth: Math.round(page.width),
    pageHeight: Math.round(page.height),
    segments,
  });

  let reply: string;
  try {
    reply = await classifier.complete(CLASSIFY_CONTRACT, [{ role: 'user', content: user }]);
  } catch {
    return base; // provider unavailable → heuristic stands
  }
  const parsed = parseSegments(reply, page.texts.length);
  if (!parsed) return base;
  return merge(base, parsed, options.onlyAmbiguous ?? true);
}
