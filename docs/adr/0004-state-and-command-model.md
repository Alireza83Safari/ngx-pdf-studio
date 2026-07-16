# ADR-0004: Designer state & command model

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Principal engineer
- **Related:** spec §8, §8A, §13; ADR-0005 (topology)

## Context

The designer needs undo/redo over **every** mutation, drag-coalescing,
autosave/draft recovery, multi-select, and a reactive UI — across Angular
12→latest (no Signals, no `inject()`, RxJS 6 **and** 7). The spec is emphatic:
state mutations go **exclusively through commands**; components **never** mutate
the template tree directly (§8). State must be **framework-agnostic** so it is
unit-testable without Angular and reusable by the Node path.

## Decision

A framework-agnostic **`DocumentStore`** in `core` holding an **immutable**
`PdfTemplate` plus an explicit **command stack**:

- Every mutation is a `Command` with `apply(state) → state` and `invert(state) →
Command` (or a captured inverse), making undo/redo reversible by construction.
- The store exposes state changes as an **RxJS `Observable`** (RxJS is already a
  required peer; using the 6∩7 common API keeps it version-safe). No NgRx — it
  is Angular-coupled and overkill for a single document model.
- **Coalescing:** drag/resize emit many commands tagged with a coalesce key; the
  history merges consecutive same-key commands into one undo step.
- Immutability via structural sharing (plain spread / a tiny helper, not Immer,
  to avoid a dependency and keep determinism). Selectors derive view state.
- **Autosave/draft recovery** is a store subscriber that persists serialized
  state on a debounced schedule via a pluggable `DraftStorage` interface
  (localStorage in browser; injectable elsewhere).

The Angular `designer` package wraps `DocumentStore` in a thin service and
exposes its observables through the `async` pipe + `OnPush`.

## Options considered

- **Custom immutable store + command pattern** (chosen) — exactly matches the
  "command pattern, reversible, coalescing, framework-agnostic" requirement;
  testable in pure TS; no Angular coupling; RxJS-version-safe.
- **NgRx Store + Effects** — mature but Angular-only (breaks the `core`
  framework-agnostic rule), heavy boilerplate, and its action/reducer model does
  not give reversible undo for free.
- **Signals-based store** — forbidden in distributed code (Angular 16+ only,
  §2.1).
- **Immer-backed reducer** — ergonomic immutability, but adds a dependency and
  its proxy/patch behaviour complicates the deterministic, hand-auditable
  inverse-command story.

## Consequences

- **Positive:** undo/redo is correct by construction; the entire editing model
  is unit-testable without a browser; works unchanged on Angular 12→latest.
- **Negative / costs:** we hand-write immutability helpers and command inverses
  (more discipline than Immer); we provide our own selector memoization.
- **Risks & mitigations:** command/inverse drift is caught by a property test —
  "apply then invert returns the original state" — run over generated command
  sequences (§13 integration tests).
- **Revisit when:** the document model grows large enough that structural
  sharing by hand becomes error-prone, at which point a vetted immutable lib
  behind the same `Command` interface is reconsidered.

## Amendment (2026-06-24): observable API placement

The original note said the store "exposes state changes as an RxJS Observable."
On implementation that is wrong for `core`: RxJS is a peer of the **Angular**
library, not of the framework-agnostic engine, and `core` must stay
dependency-free of it. Resolution: `DocumentStore` (in `core/src/document/`)
exposes a **minimal listener API** — `subscribe(listener): () => void` (emits
the current state immediately, then on each change). The Angular designer service
adapts this to an RxJS `Observable` at the framework boundary. This preserves the
"reactive store" intent while keeping `core` Angular/RxJS-free (ADR-0005).

Implemented: immutable `template-ops` (structural sharing), reversible `Command`
factories (patch / move-resize / add / remove / z-order / page / static text)
with `coalesceKey` drag-merging, and `DocumentStore` (dispatch/undo/redo, redo
invalidation on new dispatch).
