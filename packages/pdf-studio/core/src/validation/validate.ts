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
 * Validate an arbitrary value as a {@link PdfTemplate}. On success the value is
 * returned typed (the schema has proven its shape); on failure a list of
 * structured issues is returned.
 */
export function validateTemplate(value: unknown): ValidationResult {
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
  return templateSchema.safeParse(value).success;
}
