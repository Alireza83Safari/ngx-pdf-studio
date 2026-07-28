# Getting started

`@ngx-pdf-studio` turns a **template JSON + data JSON** into a real PDF — in the
browser and on Node, with byte-identical output. This guide walks the shortest
path from zero to a rendered document.

## 1. The mental model

```
PdfTemplate ──┐
              ├─→ paginate() ─→ Page[] ─→ paintToSvg()  (preview)
data JSON  ───┘                       └─→ paintToPdf()  (the file)
```

- A **template** describes pages, bands, and elements — it is plain JSON,
  validated by `validateTemplate`, and round-trips losslessly.
- **Bands** flow down the page: `reportHeader`, `pageHeader`, `detail` (repeats
  per data row), `groupHeader`/`groupFooter`, `pageFooter`, `reportFooter`,
  `background`/`watermark`.
- **Elements** live inside bands at fixed coordinates (pt, top-left origin).
- Both painters consume the **same** laid-out `Page[]`, so the preview _is_ the PDF.

## 2. Render on Node

```js
const {
  render, // alias of renderToPdf → { bytes, pageCount, diagnostics }
  renderToFile, // (template, input, path, options)
  renderBatch, // one PDF per record
  renderMerged, // one PDF, records concatenated
  loadBundledVazirmatn,
} = require('@ngx-pdf-studio/core/node');

const result = await renderToFile(template, { data }, 'out.pdf', {
  pdf: { fonts: loadBundledVazirmatn(), metadata: { title: 'گزارش' } },
});
console.log(result.pageCount, result.diagnostics);
```

`diagnostics` is a list of non-fatal warnings (bad expression, missing dataset,
unknown barcode symbology, …). Rendering never throws for data problems.

## 3. Render in Angular

```ts
import { PdfStudioRendererModule } from '@ngx-pdf-studio/angular';

@NgModule({ imports: [PdfStudioRendererModule] })
export class ReportModule {}
```

`PdfStudioRenderer.render({ template, data, parameters?, options? })` resolves to
`{ bytes, blob, pageCount, diagnostics }` — with `renderSvg`, `download`, `open`,
and `toObjectUrl` alongside it. The service is `providedIn: 'root'`, so importing
the module above is only needed for the preview component:
`<pdf-studio-preview [template]="..." [data]="...">` renders the live SVG preview
(one `<svg>` per page, same geometry as the PDF).

## 4. Bind data

Any element property typed `Expression` is `{ source: '<expr>' }` evaluated
against the current scope — see the
[expression language reference](expression-language.md).

```jsonc
// a detail band repeating over `items`, with a computed column
{
  "id": "rows",
  "type": "detail",
  "dataset": "items",
  "height": { "mode": "fixed", "value": 18 },
  "elements": [
    {
      "id": "n",
      "type": "dataField",
      "value": { "source": "name" },
      "bounds": { "x": 0, "y": 0, "width": 200, "height": 16 },
      "zIndex": 1,
    },
    {
      "id": "sum",
      "type": "dataField",
      "value": { "source": "qty * price" },
      "bounds": { "x": 220, "y": 0, "width": 100, "height": 16 },
      "zIndex": 1,
    },
  ],
}
```

Datasets are declared once (`datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }]`)
and referenced by `detail` bands, tables, lists, and charts.

## 5. Fonts

For Persian (or any non-WinAnsi text) embed a real font:

- Node: `loadBundledVazirmatn()` (ships inside the package) or
  `loadFontFile(path, family, { weight })`.
- Browser: pass `{ family, bytes }` with the TTF bytes you fetched/bundled.

Set `typography.fontFamily` on elements (or a named style) to match the family.

## 6. Design visually

Run `npm run designer:build` once, open
`apps/playground/designer/designer.html`, and design with the mouse — or start
from the **template gallery** (🗂). Export the template JSON and feed it to the
renderer above; the JSON is the contract between design-time and run-time.

## 7. Validate untrusted templates

```js
const { importTemplate } = require('@ngx-pdf-studio/core');
const res = importTemplate(jsonString); // parse + validate + migrate
if (!res.success) console.error(res.issues);
```
