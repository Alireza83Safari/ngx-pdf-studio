# ADR-0001: PDF rendering stack

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Principal engineer
- **Related:** spec §7, §10, §11; ADR-0003 (bidi/shaping), ADR-0005 (topology)

## Context

We must emit **real** PDFs: selectable/searchable text, embedded + subsetted
fonts, vector graphics, images, links, metadata, compression. Hard
differentiators:

- **RTL / Persian**: correct bidirectional ordering (UAX #9) and Arabic
  contextual glyph shaping, verified _in the PDF_, not merely in the browser.
- **WYSIWYG**: preview and PDF consume the **same** `Page[]` layout tree (§7);
  text must be measured with the **same font metrics** in both paths.
- **Browser + Node parity** with byte-identical output (§3).
- We already own layout/pagination in `core`, so the PDF layer only needs to be
  a **painter** of a pre-computed geometry tree, not a layout engine.

## Decision

Use **`pdf-lib`** for PDF construction + **`@pdf-lib/fontkit`** for font
embedding and subsetting. We implement the text pipeline ourselves on top of
`core`: bidi reordering (ADR-0003) → shaping → glyph runs with explicit
positions, drawn with `pdf-lib` low-level content operators.

This is option (1) from the spec, chosen deliberately over the alternatives.

## Options considered

1. **`pdf-lib` + `@pdf-lib/fontkit`** (chosen) — full control of drawing, font
   embedding, and subsetting; pure JS; runs in browser and Node identically;
   deterministic byte output achievable. We must implement bidi + shaping +
   glyph layout ourselves. _Most work, best Persian outcome, best WYSIWYG/parity
   control._
2. **`pdfmake`** — declarative and quick to start, but pagination and RTL/Persian
   shaping are weak/awkward and we cannot drive it from our own `Page[]` tree.
   Disqualified for "best-in-class" RTL.
3. **`jsPDF` (+ plugins)** — lightweight but manual font/RTL handling, weaker
   subsetting story, less deterministic. No advantage over pdf-lib for our needs.
4. **Headless HTML/SVG → PDF** — strong WYSIWYG, but selectable text + Persian
   shaping + offline browser-only + byte parity make it risky and heavy.
   Disqualified for the browser-only constraint.

## Consequences

- **Positive:** total control over glyph placement (essential for shaped
  Persian), one code path for browser + Node, deterministic bytes for snapshot
  tests, font subsetting via fontkit keeps output small.
- **Negative / costs:** we own the hardest text problems — bidi, shaping, line
  breaking. This is the largest engineering investment in the project and is
  exactly where competitors are weak (so it is also the moat).
- **Risks & mitigations:**
  - _Shaping correctness_ — fontkit exposes GSUB/GPOS; we drive shaping from the
    font's OpenType tables rather than trusting the browser. Verified by
    extracting text + rasterizing the §11 fixture against goldens.
  - _Determinism_ — `pdf-lib` allows fixed document IDs / no timestamps; we set
    them explicitly so identical inputs ⇒ identical bytes (browser/Node CI job).
  - _Advanced standards_ (PDF/A, PAdES, tagged PDF, CMYK) are not all reachable
    in browser-only `pdf-lib`. Each gets its own ADR in Phase 5C and may lean on
    the Node path (§11A scoping note).
- **Revisit when:** fontkit shaping proves insufficient for a required script,
  or a standards requirement (e.g. PAdES) forces a different/added engine.
