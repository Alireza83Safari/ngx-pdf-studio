# Bundled fonts

## Vazirmatn (Persian + Latin) — SIL Open Font License 1.1

`vazirmatn/Vazirmatn-Regular.ttf`, `vazirmatn/Vazirmatn-Bold.ttf`

- Copyright 2015 The Vazirmatn Project Authors
  (https://github.com/rastikerdar/vazirmatn).
- Licensed under the **SIL Open Font License, Version 1.1** — see
  [vazirmatn/OFL.txt](vazirmatn/OFL.txt). The OFL permits bundling and
  redistribution, so this font ships in the published package (§14A).
- Vazirmatn provides full Persian/Arabic glyph coverage **and** Latin, with
  GSUB/GPOS tables so fontkit shapes contextual joining and ligatures.

Loaded via `loadBundledVazirmatn()` from `@ngx-pdf-studio/core/node`, or import
the `.ttf` asset directly in browser bundlers and pass the bytes to the painter.

**Policy:** only permissively licensed (OFL/Apache/MIT) fonts are bundled.
Non-redistributable fonts (e.g. IRANSans) are **never** bundled (§14A).
