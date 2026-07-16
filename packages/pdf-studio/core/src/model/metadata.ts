/**
 * Template metadata (§4). Timestamps are ISO-8601 strings so the template
 * serializes deterministically and is timezone-explicit.
 */
export interface TemplateMetadata {
  name: string;
  author?: string;
  description?: string;
  /** ISO-8601 creation timestamp. */
  createdAt?: string;
  /** ISO-8601 last-modified timestamp. */
  modifiedAt?: string;
  tags?: string[];
}
