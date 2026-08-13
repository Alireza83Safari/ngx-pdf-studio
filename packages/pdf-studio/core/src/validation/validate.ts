/**
 * Runtime validation of a template against the zod schema (§4, §13, ADR-0007).
 * Used to validate imported (untrusted) template JSON and to power editor
 * tooling. Errors are returned as structured issues — never thrown into the
 * consumer's app (mirrors the §9 non-fatal error policy).
 */
import type { PdfTemplate } from '../model/template';
import { templateSchema } from './template.schema';

export interface ValidationIssue {
  /** Dotted path to the offending node, e.g. `bands.0.elements.2.bounds.x`. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { success: true; value: PdfTemplate }
  | { success: false; issues: ValidationIssue[] };

/**
 * How deeply the input graph may nest before validation refuses to look at it.
 *
 * The schema is recursive (containers hold elements hold containers), so zod
 * descends once per level and a deep enough template exhausts the call stack
 * *inside* `safeParse`. That surfaced as a raw `RangeError` thrown into the
 * consumer's app, which is the one thing this module promises never to do —
 * measured at 2000 nested containers, a 203 KiB template, small enough to slip
 * under any request-size limit.
 *
 * 200 levels of JSON is roughly 90 nested containers, which is far past any
 * design anyone lays out by hand and far short of where the stack gives way.
 */
const MAX_INPUT_DEPTH = 200;

/**
 * Is the value nested deeper than `max`?
 *
 * Iterative, with an explicit stack: a recursive depth check would overflow on
 * exactly the input it is meant to catch. The depth bound also makes a cyclic
 * object terminate, which matters because this takes `unknown` from any caller
 * and not every caller arrives via `JSON.parse`.
 */
function exceedsDepth(value: unknown, max: number): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: unknown; depth: number };
    if (depth > max) return true;
    if (Array.isArray(node)) {
      for (const item of node) stack.push({ node: item, depth: depth + 1 });
    } else if (node !== null && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        stack.push({ node: (node as Record<string, unknown>)[key], depth: depth + 1 });
      }
    }
  }
  return false;
}

/**
 * Validate an arbitrary value as a {@link PdfTemplate}. On success the value is
 * returned typed (the schema has proven its shape); on failure a list of
 * structured issues is returned.
 */
export function validateTemplate(value: unknown): ValidationResult {
  // Before zod, not after: the failure this prevents happens *inside* the parse.
  if (exceedsDepth(value, MAX_INPUT_DEPTH)) {
    return {
      success: false,
      issues: [
        {
          path: '',
          message: `Template nesting exceeds the maximum depth of ${MAX_INPUT_DEPTH}`,
        },
      ],
    };
  }
  const parsed = templateSchema.safeParse(value);
  if (parsed.success) {
    // Justified bridge: zod has validated the runtime shape against the schema
    // that mirrors PdfTemplate. The inferred type is intentionally looser (see
    // element.schema.ts header), so we surface it as the model type here.
    return { success: true, value: parsed.data as unknown as PdfTemplate };
  }
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return { success: false, issues };
}

/** Convenience boolean guard. */
export function isValidTemplate(value: unknown): value is PdfTemplate {
  // Through `validateTemplate`, not `safeParse` directly, so the depth guard
  // cannot be walked around by picking the shorter-looking entry point.
  return validateTemplate(value).success;
}
