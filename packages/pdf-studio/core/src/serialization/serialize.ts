/**
 * (De)serialization for the template (§4). Serialization is canonical
 * `JSON.stringify`, which emits keys in insertion order, so a template
 * round-trips losslessly: `serialize(deserialize(x)) === x`.
 *
 * `deserialize` is the trusted internal path: it parses and migrates but does
 * **not** strip unknown fields (preserving forward-compatible data). Use
 * {@link importTemplate} for the untrusted path, which additionally validates.
 */
import type { PdfTemplate } from '../model/template';
import { validateTemplate, type ValidationResult } from '../validation/validate';
import { migrateToCurrent, type RawTemplate } from './migrate';

export interface SerializeOptions {
  /** Pretty-print with the given indent (spaces). Default: compact. */
  indent?: number;
}

/** Serialize a template to a JSON string (canonical/compact by default). */
export function serializeTemplate(template: PdfTemplate, options: SerializeOptions = {}): string {
  return options.indent === undefined
    ? JSON.stringify(template)
    : JSON.stringify(template, null, options.indent);
}

/**
 * Parse + migrate a template JSON string into a {@link PdfTemplate}, preserving
 * unknown fields. Trusts the input shape; pair with {@link validateTemplate} (or
 * use {@link importTemplate}) when the source is untrusted.
 *
 * @throws SyntaxError if the string is not valid JSON.
 */
export function deserializeTemplate(json: string): PdfTemplate {
  const raw = JSON.parse(json) as RawTemplate;
  const migrated = migrateToCurrent(raw);
  // Justified bridge: migration preserves shape; callers needing guarantees use
  // importTemplate/validateTemplate. Keeping this path lossless is required for
  // the round-trip invariant.
  return migrated as unknown as PdfTemplate;
}

/**
 * Untrusted-import path: parse + migrate, then validate. Returns a
 * {@link ValidationResult} so import errors are non-fatal and inspectable.
 *
 * @throws SyntaxError if the string is not valid JSON.
 */
export function importTemplate(json: string): ValidationResult {
  const raw = JSON.parse(json) as RawTemplate;
  const migrated = migrateToCurrent(raw);
  return validateTemplate(migrated);
}
