# ADR-0006: Workspace tooling

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Principal engineer (workspace choice confirmed with product owner)
- **Related:** spec §3, §13, §14A

## Context

A large multi-package monorepo (engine + Angular lib + playground + docs) with a
**CI matrix across Angular 14→latest**, golden-snapshot PDF tests, and consumer
tarball smoke tests. We need good task orchestration, caching, and an
`affected`-aware CI to keep the matrix tractable. The spec prefers Nx, allows an
Angular CLI multi-project workspace.

## Decision

Use an **Nx workspace** (npm-workspaces under the hood). Rationale: task graph +
computation caching + `affected` is exactly what a wide Angular CI matrix and a
heavy snapshot suite need; Nx generators streamline adding the Angular library
and its secondary entry points.

**Phasing note:** to keep Phase 0 reviewable and runnable without committing the
full Nx plugin chain before there is Angular code to build, the workspace ships
today as npm-workspaces + direct Jest/ESLint/Prettier targets, with `nx.json`
present and the topology Nx-ready. Nx's executors and the `affected` CI graph are
wired in alongside the Angular `designer`/`renderer` packages in Phase 4. This
ADR records the destination; the README documents the current state honestly.

## Options considered

- **Nx** (chosen) — task caching, `affected`, generators, first-class Angular &
  Jest plugins; the standard for monorepos at this scale.
- **Angular CLI multi-project** — no extra tool, but weak monorepo ergonomics
  (no computation cache / `affected`), painful for a wide CI matrix and a
  pure-TS-core + Angular-adapter split.
- **Plain npm workspaces only** — minimal, but we would hand-roll the caching
  and affected logic Nx gives for free.

## Consequences

- **Positive:** scalable CI (only rebuild/test what changed), consistent
  generators, strong Angular + Jest integration.
- **Negative / costs:** Nx version upgrades are an ongoing maintenance item; a
  learning-curve for contributors unfamiliar with Nx.
- **Risks & mitigations:** the "Nx present but targets run direct" interim could
  drift; mitigated by adopting Nx executors in the same PR that introduces the
  first ng-packagr build, so the two never diverge for long.

  **That mitigation did not hold.** ng-packagr landed in Phase 4 without Nx: `nx`
  is not a dependency, no script invokes it, and `nx.json` is inert configuration
  describing a task graph nothing reads. The npm-workspaces + direct-target setup
  has carried the project to a release-ready state, so the interim is arguably
  the answer rather than a stopgap. Decide before `v1.0.0`: adopt Nx and make
  `nx.json` load-bearing, or delete it and supersede this ADR. Leaving an
  aspirational config file in the repo reads as a working cache to contributors
  and is the worst of the three.

- **Revisit when:** the workspace shrinks to a single publishable package, where
  Nx would be unnecessary overhead.
