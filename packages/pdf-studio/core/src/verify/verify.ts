/**
 * Verifiable Documents (F1) — content hash of a document.
 *
 * The hash covers everything that determines the painted output: the template,
 * the bound `data`, `parameters`, and the injected clock (`now`). Because the
 * engine renders deterministically (§3), the same inputs always yield the same
 * hash — so a QR/short code stamped on the PDF proves the document was produced
 * from exactly this data, and any tamper changes the hash.
 */
import type { PdfTemplate } from '../model/template';
import { canonicalize } from './canonical';
import { sha256Hex } from './sha256';

/** Hashing-scheme version — bump if the canonical payload shape ever changes. */
export const VERIFY_VERSION = 1;

/** The inputs (besides the template) that affect the rendered output. */
export interface VerifyInput {
  data?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  /** Fixed clock (epoch ms) used for the render; part of the hash. */
  now?: number;
}

export interface DocumentHash {
  /** Full lowercase hex SHA-256 (64 chars). */
  hash: string;
  /** First 10 hex chars — a human-friendly code to print/read aloud. */
  short: string;
}

function payloadOf(template: PdfTemplate, input: VerifyInput) {
  return {
    v: VERIFY_VERSION,
    template,
    data: input.data ?? {},
    parameters: input.parameters ?? {},
    now: input.now ?? null,
  };
}

/** Compute the content hash for a template + its render inputs. */
export function hashDocument(template: PdfTemplate, input: VerifyInput = {}): DocumentHash {
  const hash = sha256Hex(canonicalize(payloadOf(template, input)));
  return { hash, short: hash.slice(0, 10) };
}

/**
 * Recompute the hash and compare it (case/space-insensitive) to an expected
 * value read from a stamp/QR. Returns `true` only for an untampered document.
 */
export function verifyDocument(
  template: PdfTemplate,
  input: VerifyInput,
  expected: string,
): boolean {
  const want = expected.trim().toLowerCase();
  const { hash } = hashDocument(template, input);
  // accept the full 64-char hash, or a prefix (e.g. the printed short code)
  return want.length >= hash.length ? want === hash : want === hash.slice(0, want.length);
}
