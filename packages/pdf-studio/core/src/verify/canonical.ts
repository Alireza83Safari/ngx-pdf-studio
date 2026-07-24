/**
 * Canonical JSON for hashing (F1). Two structurally-equal values must produce
 * the exact same string regardless of object key insertion order, so the
 * document hash is stable across editors, sessions, and platforms.
 *
 * Rules: object keys sorted lexicographically (recursively); array order kept;
 * `undefined` members dropped (as `JSON.stringify` would); primitives via
 * `JSON.stringify` (so `-0`→`0`, `NaN`/`Infinity`→`null`).
 */
function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    out[key] = sortValue(obj[key]);
  }
  return out;
}

/** Deterministic JSON string with recursively sorted object keys. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
