# Documentation index — @ngx-pdf-studio

The Angular PDF **designer** + framework-agnostic **generation engine**. This page is the
map of everything under `docs/`. Start at the top and follow what you need.

> Canonical spec: [`../pdf-studio-build-prompt.md`](../pdf-studio-build-prompt.md) (the
> original build brief; ADRs and the roadmap cite it as "spec §N").
> Project overview & status: [`../README.md`](../README.md) · [`../ROADMAP.md`](../ROADMAP.md) · [`../TODO.md`](../TODO.md)

## Start here

- [getting-started.md](getting-started.md) — zero-to-PDF in Node and in Angular, plus the
  core mental model (`createRenderContext → paginate → paint`).

## Guides

- [expression-language.md](expression-language.md) — the sandboxed expression DSL:
  literals & operators, scope resolution order, and the whitelisted function/format catalog.
- [rtl-persian.md](rtl-persian.md) — RTL/Persian recipe: what the engine handles for you
  (bidi, shaping, Jalali, digits) vs. what you choose, with a correct-document checklist.
- [designer-guide.md](designer-guide.md) — **راهنمای کامل دیزاینر** (Persian): end-user
  guide to the visual editor — concepts, data binding, expressions in the inspector,
  layout, page setup, export, and keyboard shortcuts.

## Architecture decisions (ADR)

Numbered, immutable records of why the stack is what it is. Template: [0000](adr/0000-adr-template.md).

- [ADR-0001 — PDF rendering stack](adr/0001-pdf-rendering-stack.md): `pdf-lib` + `@pdf-lib/fontkit` for construction and font embedding.
- [ADR-0002 — Jalali calendar library](adr/0002-jalali-calendar-library.md): `date-fns-jalali`, wrapped behind our own adapter.
- [ADR-0003 — Bidi & shaping](adr/0003-bidi-and-shaping.md): `bidi-js` (UAX #9) for segmentation + Persian/Arabic glyph shaping.
- [ADR-0004 — State & command model](adr/0004-state-and-command-model.md): framework-agnostic immutable `DocumentStore` in core.
- [ADR-0005 — Package topology](adr/0005-package-topology.md): two npm packages (core + angular).
- [ADR-0006 — Workspace tooling](adr/0006-workspace-tooling.md): Nx workspace over npm-workspaces.
- [ADR-0007 — Template validation](adr/0007-template-validation.md): `zod` runtime schemas mirroring the TS types + versioning.

## Keeping this index current

This index is meant to stay in sync with the folder on its own. Whenever a doc is
**added, renamed, removed, or changes scope** — or a new ADR lands — update the matching
line here in the same change (see [`adr/0000-adr-template.md`](adr/0000-adr-template.md)
for the ADR shape). One line per file, newest ADR appended in numeric order. If you learn
something durable while doing that, also drop it into the assistant memory graph so the
next session starts from it.
