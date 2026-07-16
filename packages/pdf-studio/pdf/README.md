# pdf (layer of `@ngx-pdf-studio/core`)

Pure-TS PDF painter: font embedding & subsetting, bidi reordering, Persian/Arabic
glyph shaping, vector drawing, image embedding — consuming the `core` `Page[]`
layout tree (§7, §10). **Zero Angular.** Runs in browser and Node with
byte-identical output (§3).

**Status:** scaffolded. Lands in **Phase 1** (PDF painter MVP: static text +
shapes + one embedded font) and **Phase 3** (bidi + shaping + bundled fonts).
See ADR-0001 (pdf-lib + fontkit) and ADR-0003 (bidi-js + fontkit shaping).
