# ADR-0005: Package topology & distribution

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Principal engineer
- **Related:** spec §3, §12, §14A

## Context

The spec offers two shapes (§14A): (A) one package with multiple entry points,
or (B) a framework-agnostic core package + a separate Angular adapter package.
Hard requirements either way: the **render-only path must be importable without
the heavy designer**; `core`/`pdf` must run in **browser and Node**; the library
supports **Angular 14→latest**; non-Angular consumers should be able to use the
engine.

> The spec asked for Angular 12→latest (§2.1). ng-packagr stamps its partial-Ivy
> declarations `minVersion: "14.0.0"`, which Angular 12/13 refuse to link, so 14
> is the floor the artifact can actually honour. Reaching 12 would mean a second
> build with an old ng-packagr — not worth it for two majors that are years past
> end of support.

## Decision

Adopt the **recommended split (B)**, published as two npm packages:

- **`@ngx-pdf-studio/core`** — framework-agnostic engine (the `core` + `pdf`
  source layers), runs in browser **and** Node, usable without Angular. Built
  with `tsc` (pure TS), no ng-packagr. Exposes a `./node` subpath for the
  server entry point.
- **`@ngx-pdf-studio/angular`** — the Angular library, built with **ng-packagr**
  (APF, partial-Ivy). Depends on `core`. Entry point `.` ships the renderer +
  preview and is deliberately lightweight; the designer is planned as a separate
  `./designer` entry point so render-only consumers stay small.

**Not yet built, kept here as the intended shape:** the `./designer` secondary
entry point, and an **internal** `@ngx-pdf-studio/shared` workspace package
(tokens, model re-exports, utils) consumed by both and never published
standalone. Today `core` carries that surface directly and `angular` has a
single entry point; neither has needed the split yet.

## Options considered

- **(B) core + Angular adapter** (chosen) — widens adoption to non-Angular and
  Node consumers, makes the framework-agnostic boundary a _package_ boundary
  (not just a folder convention, so violations fail at build), and naturally
  keeps the engine free of Angular peer deps.
- **(A) single package, multiple entry points** — simpler release process and
  one version to reason about, but bleeds the Angular peer-dep expectation onto
  engine-only consumers and makes the "no Angular in core" rule a convention
  rather than an enforced boundary.

## Consequences

- **Positive:** clean dependency direction (`angular → core`, never the
  reverse); engine is independently testable, versionable, and adoptable; the
  render-only chunk is small; the Node story is a first-class subpath, not an
  afterthought.
- **Negative / costs:** two packages to version and release; we must keep `core`
  and `angular` semver-compatible (managed with Changesets in Phase 6); a
  cross-package internal `shared` needs build ordering.
- **Risks & mitigations:** version-skew between `core` and `angular` is mitigated
  by releasing both from one tag and pinning `angular`'s dependency on `core` to
  `^<version>` at publish time (`tools/prepare-angular-dist.mjs`), plus a
  consumer tarball smoke test (§14A) that installs both together, and a linker
  smoke test that proves the advertised Angular floor.
- **Revisit when:** maintenance overhead of two packages outweighs the adoption
  benefit, or if a monorepo-internal-only future makes a single package simpler.
