# @ngx-pdf-studio

A best-in-class Angular PDF **designer** and **generation engine** — a
JasperReports / Stimulsoft-class report tool, rebuilt natively for TypeScript
with first-class **RTL / Persian** support.

Both published packages are gated at **≥90% statement coverage** in CI, on Node
18/20/22 and against Angular 14 → latest. Byte-deterministic PDF output, WYSIWYG
by construction (one layout tree feeds both the SVG preview and the PDF), and a
working in-browser visual designer with a template gallery.

## Packages

| Package                     | What it is                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `@ngx-pdf-studio/core`      | Framework-agnostic engine: model, expressions, layout, painters. Browser + Node, identical bytes. |
| `@ngx-pdf-studio/core/node` | Node entry: `renderToFile`, `renderBatch`, `renderMerged`, `loadBundledVazirmatn`.                |
| `@ngx-pdf-studio/angular`   | Angular render service + `<pdf-studio-preview>` (Angular 14 → latest, APF).                       |

## Quick start (Node)

Not on npm yet — build the package and install the packed dist:

```bash
npm run build:core                       # compile + prepare packages/pdf-studio/core/dist
npm pack packages/pdf-studio/core/dist   # → ngx-pdf-studio-core-0.0.0.tgz

# then, in your own project:
npm i /path/to/ngx-pdf-studio-core-0.0.0.tgz
```

> Install from `dist`, not from the workspace folder: the source `package.json`
> points `main` at `src/index.ts`, so `file:packages/pdf-studio/core` hands a
> consumer raw TypeScript. `npm run smoke:tarball` exercises exactly the flow
> above. For Angular, run `npm run build` and install **both** tarballs (the
> Angular package depends on core).

```js
const { renderToFile, loadBundledVazirmatn } = require('@ngx-pdf-studio/core/node');

const template = {
  schemaVersion: '1.0.0',
  metadata: { name: 'invoice' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
    direction: 'rtl',
    locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
    unit: 'pt',
  },
  styles: [],
  datasets: [],
  parameters: [],
  bands: [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 60 },
      elements: [
        {
          id: 't',
          type: 'dataField',
          bounds: { x: 0, y: 0, width: 300, height: 24 },
          zIndex: 1,
          value: { source: "'سلام، ' + customer.name" },
          typography: { fontFamily: 'Vazirmatn', fontSize: 16 },
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

await renderToFile(template, { data: { customer: { name: 'علی رضایی' } } }, 'invoice.pdf', {
  pdf: { fonts: loadBundledVazirmatn() },
});
```

## Quick start (Angular)

```ts
import { PdfStudioRenderer } from '@ngx-pdf-studio/angular';

constructor(private renderer: PdfStudioRenderer) {}

async download() {
  // → { bytes, blob, pageCount, diagnostics }
  const result = await this.renderer.render({ template, data });
  this.renderer.download(result, 'invoice.pdf'); // or use result.blob / result.bytes
}
```

```html
<!-- live SVG preview, same layout tree as the PDF -->
<pdf-studio-preview [template]="template" [data]="data"></pdf-studio-preview>
```

## Visual designer

A zero-install, in-browser WYSIWYG designer ships in the repo:

```bash
npm install
npm run designer:build
# then open apps/playground/designer/designer.html in a browser
```

- **True WYSIWYG canvas** — the page background is the engine's own SVG painting,
  measured with the same fonts the PDF embeds, so a line breaks on screen where
  it breaks on paper. The active band's extent is drawn on the sheet, and content
  reaching past it is flagged before it collides with the band below.
- **Toolbox (12)** — text, data field, rectangle, line, ellipse, image, barcode,
  QR, chart, table, labelled field, page field.
- **Template gallery** (🗂) — 22 Persian/RTL templates across five categories
  (finance, office/HR, reporting, marketing, labels & cards), loaded with one
  click, with live engine-rendered thumbnails.
- **Assets** — drop a PNG/JPEG on the canvas to embed a logo, or load a TTF/OTF
  to use your own typeface; both are stored in the template so it stays portable.
- **Inspector** — full typography (family, size, weight, italic, underline,
  strike, alignment incl. Persian kashida justification, vertical alignment,
  letter spacing, line height), a complete box panel (fill, per-side borders,
  dashed/dotted, corner radius, padding, opacity), and conditional styling.
- **Page setup** — size, orientation, margins, display unit (pt/mm/cm), writing
  direction, digits (Persian/Latin) and calendar (Jalali/Gregorian).
- Eight resize grips plus a rotation grip, snap to grid + element edges with live
  guides, multi-select (Shift), marquee, align/distribute, z-order, inline edit
  (double-click), field picker with **drag-to-bind**, zoom, autosave, undo/redo,
  JSON import/export, PDF download.
- **Live diagnostics** — engine warnings for the whole document appear as you
  edit, not only when you export, with a jump to the element that caused each.

## Engine features

- **Template model** — fully typed, zod-validated, lossless round-trip, schema migration.
- **Sandboxed expressions** — no `eval`; lexer → Pratt parser → evaluator, whitelisted
  functions (`sum`, `avg`, `slice`, `toWords`, …), scope chain (`$index`, `$page`,
  `$group`, `$vars`, `$root`, `$parameters`), non-fatal diagnostics. See
  [docs/expression-language.md](docs/expression-language.md).
- **Bounded by construction** — `paginate` takes `limits` capping pages, rows per
  dataset, document-wide expression steps, and nesting depth. Defaults sit far
  above any authored report; tighten them when the templates are not yours. A
  template is paid for by the row, not the byte, so a small one can still be
  expensive. See [SECURITY.md](SECURITY.md).
- **Pagination** — pure `(template, data) → Page[]`: repeating page header/footer,
  master pages (first/odd/even), sections with independent page setup + per-section
  page-number restart, multi-column flow, explicit page breaks, grouping with
  multi-level headers/footers, report variables with reset scopes, table split
  across pages with repeated header.
- **Elements** — static/rich text, data field, image (PNG/JPEG), table (aggregates,
  striping, RTL), list, crosstab/pivot, subreport, chart (column/bar/line/stacked/
  area/pie/donut), barcode (**Code 39, Code 128, EAN-13** + registry, human-readable
  text), QR (verified by real decode), container nesting, page fields, AcroForm
  **form fields**, rotation, and a **custom-element registry** (your renderer emits
  vector ops → both painters draw it identically).
- **Typography** — family, size, weight, italic, underline, strike-through,
  line height, letter spacing, horizontal + vertical alignment, and Persian
  kashida justification. Text is measured with the document's own fonts, so
  line breaks and auto-grown heights match what is printed.
- **Conditional formatting** — rule-based style overlays, data bars, color scales,
  icon sets.
- **PDF niceties** — bookmarks/outline, internal + external hyperlinks, XMP
  metadata, true **DeviceCMYK**, deterministic bytes (snapshot-friendly).
- **i18n** — Unicode bidi (UAX #9), Persian shaping via fontkit, bundled
  **Vazirmatn** (OFL), Latin/Persian digits, **Jalali + Gregorian** calendars.
  See [docs/rtl-persian.md](docs/rtl-persian.md).

## Docs

- [Designer guide (فارسی)](docs/designer-guide.md)
- [Getting started](docs/getting-started.md)
- [Expression language reference](docs/expression-language.md)
- [RTL / Persian guide](docs/rtl-persian.md)
- [Architecture decision records](docs/adr/)
- [Changelog](CHANGELOG.md)
- [Security policy & threat model](SECURITY.md)

## Repository layout

```
/packages/pdf-studio
  /core        ← pure TS engine: model, expressions, layout, painters (NO Angular)
  /pdf         ← shared assets (bundled fonts)
  /angular     ← Angular render service + preview component (APF)
/apps/playground
  /designer    ← in-browser visual designer (bundled engine, no dev server)
/docs          ← guides + ADRs
```

**Architectural invariant:** `core` contains **zero Angular** and runs unchanged
in Node. See [docs/adr/0005-package-topology.md](docs/adr/0005-package-topology.md).

## Angular compatibility

The published library targets **Angular 14 → latest, inclusive**. The distributed
code avoids Signals, block control flow (`@if`/`@for`), `inject()`, and
standalone-only delivery. The pure-TS `core` package has no Angular dependency.

The floor is 14 because ng-packagr emits partial-Ivy declarations stamped
`minVersion: "14.0.0"`; Angular 12 and 13 reject them at build time with _"this
application depends upon a library published using Angular version 17.x, which
requires Angular version 14.0.0 or newer"_. `npm run smoke:angular-linker 14`
runs the real linker over the built bundle and is what holds this claim honest —
a type-check against the `.d.ts` cannot, because declarations carry no version.

`core` is a **dual-format package**: `import` resolves to ES modules, `require`
to CommonJS. That is what keeps the Angular CLI from reporting a _"CommonJS or
AMD dependencies can cause optimization bailouts"_ warning and lets it
tree-shake the engine. The `core/node` subpath is CommonJS only — it is
server-side, and Node imports its named exports fine either way.

## Development

```bash
npm install
npm test               # full jest suite (core + angular)
npm run lint           # eslint
npm run typecheck      # tsc
npm run build          # core dist (CJS + d.ts + fonts) + Angular APF package
npm run smoke:tarball  # pack the dist & render a PDF from a pristine install
npm run smoke:docs     # run docs/index.html in jsdom (translations, links, code samples)
npm run smoke:angular-linker 14   # run the real Angular linker over the built bundle
npm run smoke:angular 14          # type-check a pristine consumer on that major
npm run demo           # playground: Persian invoice → PDF + HTML preview
node apps/playground/designer/smoke.js   # designer jsdom smoke test
```

Releases are cut by tagging `v*`. CI rebuilds, re-runs every gate, stamps both
packages with the tag's version, and publishes them with npm provenance — core
first, then the Angular bindings, which depend on it at `^<version>` (see
`.github/workflows/release.yml`). Publishing requires the repo secret
`NPM_TOKEN`.

No release has been cut yet (`version: 0.0.0`), which is why
[Quick start](#quick-start-node) walks through packing the dist by hand. Once the
first tag lands, collapse that back to a plain
`npm install @ngx-pdf-studio/core`.

## License

MIT (see [LICENSE](LICENSE)). The bundled Vazirmatn font is OFL-licensed
(`packages/pdf-studio/pdf/fonts/vazirmatn/OFL.txt`).
