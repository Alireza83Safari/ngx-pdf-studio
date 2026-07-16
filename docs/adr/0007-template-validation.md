# ADR-0007: Template schema validation & versioning

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Principal engineer
- **Related:** spec §4, §9, §13

## Context

The `PdfTemplate` is the single source of truth (§4). It must: be a precise TS
type; be **validated at runtime** when imported (untrusted JSON, §2.3); be
**forward-compatible** (preserve unknown fields, migrate older `schemaVersion`s);
and **round-trip losslessly**. It lives in `core`, so the validator must be pure
TS, run in browser + Node, and not pull Angular.

## Decision

Use **`zod`** as the runtime validator, with schemas mirroring the TS types and
authored to **preserve unknown keys** (`.passthrough()` on object schemas) so
forward-compatible fields survive an import → export cycle. Migration is a
pipeline keyed on `schemaVersion`: an ordered list of `(from → to)` steps applied
on load before validation. Serialization is canonical `JSON.stringify` (stable
insertion-order key emission), giving `serialize(deserialize(x)) === x`.

`zod` is explicitly sanctioned by the spec ("JSON Schema or zod/io-ts runtime
validator"). A JSON Schema can be _generated_ from the zod schemas later for
external tooling if needed.

## Options considered

- **`zod`** (chosen) — types and validator stay in lockstep, excellent error
  messages (feed editor tooling + `RenderDiagnostics`), small, tree-shakeable,
  pure JS. `.passthrough()` gives forward-compat preservation directly.
- **Hand-written JSON Schema + Ajv** — standardised artifact, but the schema and
  the TS types drift independently (two sources of truth), and Ajv's footprint
  and codegen are heavier for our needs.
- **`io-ts`** — sound but ergonomically heavier (fp-ts dependency, steeper
  authoring) with no advantage here.
- **No runtime validation** — violates §2.3 (untrusted template JSON) outright.

## Consequences

- **Positive:** one source of truth (zod schema → inferred TS type guards both);
  rich, structured errors for import validation and the field picker; forward
  compatibility via passthrough; pure-TS, parity-safe.
- **Negative / costs:** `zod` is a runtime dependency shipped to consumers (kept
  in `core`'s lean dependency list); we must keep the hand-written `interface`
  surface and the zod schema aligned (covered by a type-level conformance test).
- **Risks & mitigations:** schema/type drift is caught by a `satisfies`-based
  conformance check and the round-trip test; migration correctness is covered by
  per-version migration fixtures (§13).
- **Revisit when:** an external consumer needs a published JSON Schema as the
  canonical contract, in which case we generate it from zod rather than
  hand-maintaining it.
