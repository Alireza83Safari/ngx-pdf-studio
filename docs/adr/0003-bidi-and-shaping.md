# ADR-0003: Bidirectional layout & Persian/Arabic glyph shaping

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Principal engineer
- **Related:** spec §7, §10, §11; ADR-0001 (pdf-lib/fontkit)

## Context

Mixed Persian / English / numbers must lay out correctly on a single line, with
**identical results in preview and PDF** (§7, §11). Two distinct problems:

1. **Bidi reordering (UAX #9):** given a logical-order string + base direction,
   compute the visual order of runs and the directional levels.
2. **Glyph shaping:** Arabic-script text uses contextual joining (isolated /
   initial / medial / final forms) and ligatures. We must produce the correct
   _shaped glyph IDs_, because PDF positions glyphs explicitly — the browser's
   shaping does not carry into a `pdf-lib`-drawn document (ADR-0001).

We must not trust the browser for either, or preview and PDF will diverge.

## Decision

- **Bidi:** use **`bidi-js`** (pure JS, UAX #9 implementation) to segment text
  into directional runs and resolve levels. One engine, called by both painters
  via a `core` `BidiService` interface.
- **Shaping:** drive shaping from the embedded font's OpenType tables via
  **`@pdf-lib/fontkit`** (GSUB for joining/ligatures, GPOS for positioning).
  For the common Arabic-script joining behaviour we implement a deterministic
  joining-type pass (per Unicode joining types) feeding fontkit's GSUB lookups,
  so the same glyph runs are produced in browser and Node.

Both live behind interfaces in `core`; the painters consume produced glyph runs
and never re-shape.

## Options considered

- **`bidi-js`** (chosen) — focused, dependency-free UAX #9 implementation,
  small, deterministic.
- **`unicode-bidirectional`** — also viable but larger and less maintained.
- **Browser `canvas`/DOM measurement for preview + separate PDF path** —
  rejected outright: guarantees preview≠PDF divergence, the cardinal sin of §7.
- **HarfBuzz (WASM, `harfbuzzjs`)** for shaping — gold-standard shaping quality,
  but adds a WASM blob, complicates the byte-deterministic + small-bundle story,
  and is heavier than needed for Persian/Latin. _Kept as a documented escape
  hatch_ behind the shaping interface if fontkit's shaping proves insufficient
  for a required script.

## Consequences

- **Positive:** a single bidi + single shaping path shared by both painters
  guarantees WYSIWYG parity by construction; pure JS keeps browser/Node parity
  and determinism.
- **Negative / costs:** Arabic joining + GSUB/GPOS driving is intricate; this is
  the second-largest text investment after the painter itself.
- **Risks & mitigations:** the §11 mixed-direction fixture (Persian RTL +
  English LTR + inline numbers, with extracted-text-order assertions and a
  raster snapshot) is the acceptance gate; if fontkit shaping falls short we
  swap in `harfbuzzjs` behind the unchanged `ShapingService` interface.
- **Revisit when:** a non-Arabic complex script (e.g. Indic) is required, which
  would likely force the HarfBuzz path.

## Amendment (2026-06-24): progress & the end-to-end recipe

Landed: `bidi-js` integrated (`core/src/i18n/bidi.ts`) for base-direction
detection and visual reordering; content-based `'auto'` direction resolution
wired into layout; and `FontkitTextMeasurer` (`core/src/layout/fontkit-measurer.ts`)
measuring with real advance widths/kerning so the engine and the PDF painter
share metrics (closes the §7 metric-parity gap when fonts are supplied).

**The remaining end-to-end Persian recipe** (next Phase-3 step) is now pinned:

1. **Reshape** Arabic-script runs to contextual presentation forms (joining
   types → isolated/initial/medial/final) so a font's Presentation-Forms glyphs
   render correctly even through pdf-lib's `drawText`.
2. **Reorder** to visual order with `reorderToVisual` (already implemented).
3. **Draw** the reshaped+reordered string; pdf-lib delegates custom-font
   encoding to `fontkit.layout`, which applies GSUB — so joined forms render.

This avoids a low-level glyph-by-GID drawing path in pdf-lib. It requires
bundling **Vazirmatn** (OFL) and an Arabic reshaper + golden snapshot/text
extraction tests (the §11 fixture). Tracked as the next unit of work.
