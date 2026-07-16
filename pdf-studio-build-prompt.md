# BUILD PROMPT — "PdfStudio": A Best‑in‑Class Angular PDF Designer & Generation Library

> Working package name: **`@your-scope/pdf-studio`** (rename freely). Treat everything below as a hard specification. Where a decision is left open, you must record it as an **ADR** (Architecture Decision Record) before implementing.

---

## 0. Your Role & Operating Principles

You are a **principal frontend engineer**. You write code that passes review at a top product company on the first pass. You optimize, in order: **correctness → readability → testability → extensibility → performance**. You never over‑engineer; every abstraction must earn its place with a concrete, present need (not a hypothetical one).

Rules of engagement:
- **Plan before code.** Open every phase with a short design note + the public types you intend to add. Wait for nothing — proceed — but make the design legible.
- **Small, reviewable units.** Many small, single‑responsibility files over a few large ones. No file > ~300 lines without a reason.
- **No magic.** No `eval`, no `new Function`, no `any` in public surfaces, no silent `as` casts to dodge the type checker.
- **Document the *why*, not the *what*.** Code says what; comments and ADRs say why.
- **If a requirement here is ambiguous or contradictory, surface it and propose a resolution** instead of guessing silently.

---

## 1. Mission

Build **one self‑contained Angular library** that delivers two things:

1. **A visual PDF designer** (`<pdf-studio-designer>`) — an end‑user, drag‑and‑drop environment to author PDF templates: place text/fields/images/tables/shapes, define page headers/footers that repeat, define repeating detail bands bound to arrays, style everything, and save the result as a portable **template JSON**.
2. **A rendering engine** — takes a template JSON + an arbitrary **data JSON**, binds dynamic fields, and produces a **pixel‑accurate, real PDF** in the browser (selectable text, embedded fonts, vector graphics).

The bar: **a consuming team should never need another PDF tool.** This is a JasperReports / Stimulsoft‑class report designer, rebuilt natively for Angular and for first‑class **RTL / Persian** support.

**Two success metrics, weighted equally.** (1) The *engine* is judged on correctness. (2) The *designer* is judged on **craft**: whether a non‑technical author can produce a genuinely beautiful document in minutes, with no instruction, and *enjoy* doing it. A correct engine behind a clunky editor is a failure. Benchmark the designer’s look and feel against **Canva, Figma, and Webflow** — see §8A, which is as binding as the engine sections.

Two audiences, both must be delighted:
- **Library consumer (developer):** `npm i`, drop a component or call a render service, pass data, get a `Blob`/`Uint8Array`. Zero ceremony for the happy path; deep config available when needed.
- **Template author (end‑user):** never touches code. Designs the document visually, defines fields like `anbar.name`, previews against sample data, exports the template.

---

## 2. Non‑Negotiable Constraints

### 2.1 Angular version support: **12 → latest, inclusive**
This is the single most important constraint and the easiest to get wrong. The **distributed library code** MUST run on Angular 12 through the latest release.

Therefore, **inside the published library** you MUST NOT use any API unavailable on Angular 12:
- ❌ No Signals (`signal`/`computed`/`effect`) — 16+ only.
- ❌ No block control flow (`@if` / `@for` / `@switch`) in library templates — 17+ only. Use `*ngIf` / `*ngFor` / `*ngSwitch`.
- ❌ No `inject()` in distributed code — stable from 14.1; for 12/13 support use **constructor DI**.
- ❌ No standalone‑only delivery — standalone is GA in 15. You MUST ship **NgModules** so 12–14 consumers can import the library. (You MAY *additionally* expose standalone entry points for modern consumers, but NgModule support is mandatory.)
- ✅ Compile the library with **partial‑Ivy** via `ng-packagr` (the default) so it is consumable across the whole range.
- ✅ Support **RxJS 6 and 7** (Angular 12 ships RxJS 6; 13+ ships 7). Avoid version‑divergent operators or peer‑dep both.
- ✅ Declare a wide peer range, e.g. `"@angular/core": ">=12.0.0 <99.0.0"`.
- ✅ Assume **Zone.js is present** (do not require zoneless).

> The **demo/playground app** is a *separate* package and may use the latest Angular, Signals, and new control flow. Keep these worlds strictly separated. The library is conservative; the demo is modern.

### 2.2 Quality gates (build fails otherwise)
TypeScript `strict: true` (+ `noImplicitOverride`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint clean, Prettier‑formatted, all tests green, coverage thresholds met (§13), public API documented.

### 2.3 Safety
No arbitrary code execution. The expression engine (§9) is a **sandboxed parser/evaluator**, never `eval`. Untrusted template JSON must never be able to execute host code.

### 2.4 Fully bilingual & bidirectional — Persian **and** English, both first‑class
Neither language is the "default" with the other bolted on. Both are equal citizens, and the system must handle them **mixed**:
- Documents may be **LTR or RTL**, and a single document — even a single line — may mix Persian, English, and numbers, laid out correctly (bidi).
- **Per‑document and per‑element** control of direction, language, digit system (Latin vs Persian), and calendar (Gregorian vs Jalali).
- Correct **Persian glyph shaping** and **bidirectional layout** in both the designer canvas and the rendered PDF.
- The **editor UI itself** ships in both **Persian and English**, switchable at runtime, with the chrome flipping LTR↔RTL accordingly — and this is **independent** of the document’s language (you can author an English document while using the Persian UI, and vice versa). (Details in §11.)

---

## 3. Workspace & Project Shape

Use an **Nx workspace** (preferred) or an Angular CLI multi‑project workspace.

```
/packages
  /pdf-studio            ← the publishable library (Angular 12-safe)
    /core                ← pure TS: model, expression engine, layout/pagination, binding (NO Angular)
    /pdf                 ← PDF painter (font embedding, bidi, drawing) — pure TS where possible
    /designer            ← Angular UI: canvas, toolbox, inspector, outline (NgModule + components)
    /renderer            ← Angular-facing render service + preview component
    /shared              ← tokens, models re-exports, utils
/apps
  /playground            ← demo app (latest Angular, modern syntax) showcasing every feature
  /docs                  ← (optional) docs site
```

**Critical architectural rule:** the **`core`** and **`pdf`** layers contain **zero Angular**. They are framework‑agnostic, unit‑testable in isolation, and could be reused outside Angular. Angular lives only in `designer` and `renderer`. This separation is what makes the engine testable and the package maintainable.

**Headless / server‑side parity (non‑negotiable for a professional tool):** `core` + `pdf` MUST also run **in Node.js**, with **byte‑identical output** to the browser for the same inputs. The intended workflow is *design in the browser → generate at scale on the server*. This means: no hard dependency on `window`/`document`/Canvas DOM in `core`/`pdf` (abstract any environment dependency behind an interface with browser + Node implementations — e.g. font loading, image decoding, text measurement). Ship a thin Node entry point (`@your-scope/pdf-studio/node`) exposing the same `render()` over a template + data. Add a CI job that renders the same fixtures in browser and Node and asserts identical bytes.

---

## 4. The Template Model (the heart of the system)

Design a **versioned, serializable, framework‑agnostic** template schema. It is the single source of truth that the designer edits and the renderer consumes. It must round‑trip losslessly: `serialize(deserialize(x)) === x`.

Top‑level shape (illustrative — refine and fully type it):

```ts
interface PdfTemplate {
  schemaVersion: string;          // semver of the template format; migrate older versions on load
  metadata: TemplateMetadata;     // name, author, createdAt, description
  page: PageSetup;                // size, orientation, margins, columns, direction (rtl/ltr)
  styles: NamedStyle[];           // reusable style definitions referenced by id
  datasets: DatasetDef[];         // declared data shapes/sources (see §9)
  parameters: ParameterDef[];     // external inputs (e.g. title, logoUrl)
  bands: Band[];                  // ordered sections (see §6)
  resources: ResourceBundle;      // embedded fonts, images, by id
}

interface PageSetup {
  size: 'A4' | 'A5' | 'A3' | 'Letter' | 'Legal' | { width: number; height: number };
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  columns?: { count: number; gap: number };
  direction: 'ltr' | 'rtl';       // document default; overridable per band/element (incl. 'auto' bidi-detect)
  locale: LocaleSetup;            // document-default language/digits/calendar; overridable per element
  unit: 'pt' | 'mm';              // internal canonical unit is points; mm is a display convenience
}

interface LocaleSetup {
  language: 'fa' | 'en' | string; // controls default direction & formatting locale; extensible
  digits: 'latn' | 'persian';     // default numeral system for fields
  calendar: 'gregorian' | 'jalali';
}
```

Requirements:
- **Canonical unit = points** internally; expose mm/px conveniences in the UI only.
- Every element references styles by id (cascade: element‑inline → named style → band → page defaults). Implement a clear, documented **style resolution order**.
- The schema must be **forward‑compatible**: unknown fields are preserved on load/save where feasible; provide a **migration pipeline** keyed on `schemaVersion`.
- Provide a JSON Schema (or zod/io‑ts runtime validator) for the template, used to validate imported templates and to power editor tooling.

---

## 5. Element Catalog

A common base, then concrete elements. All elements are positioned **relative to their containing band**.

```ts
interface ElementBase {
  id: string;
  type: ElementType;
  bounds: { x: number; y: number; width: number; height: number }; // pt, band-relative
  rotation?: number;
  zIndex: number;
  styleId?: string;
  direction?: 'ltr' | 'rtl' | 'auto'; // override doc default; 'auto' = bidi-detect from content
  locale?: Partial<LocaleSetup>;       // override language/digits/calendar for this element
  visibleWhen?: Expression;        // conditional rendering
  printWhen?: Expression;          // conditional, render-only
}
```

Ship at minimum:
- **StaticText** — fixed string, full typography.
- **DataField** — bound to an `Expression` (e.g. `anbar.name`, `items[0].price * qty`); supports a **format** descriptor (number/currency/percent/date/jalali/custom mask) and a fallback for null/undefined.
- **RichText / Paragraph** — multi‑run text with inline formatting and inline fields; wrapping, line height, alignment (incl. justify), RTL.
- **Image** — static (embedded resource) or dynamic (URL/base64 via expression); fit modes (contain/cover/fill/none); supports JPEG/PNG (and SVG → vector if feasible).
- **Table** — columns (each with header/footer/detail cells), bound to a dataset/array; per‑column width (fixed/auto/%), cell styling, borders, row striping, header repeats across page breaks, column groups, cell merging, aggregate footer cells (sum/avg/count).
- **List / Repeater** — repeats an arbitrary sub‑layout per array item (free‑form alternative to Table).
- **Line**, **Rectangle**, **Ellipse** — vector shapes with stroke/fill/dash/corner‑radius.
- **Barcode** & **QRCode** — value bindable; a **comprehensive symbology set** (Code128, Code39, EAN‑8/13, UPC, ITF, DataMatrix, PDF417, Aztec, GS1, common postal codes), with quiet‑zone and human‑readable‑text options.
- **Chart** — data‑bound charts (bar, column, stacked, line, area, pie/donut, scatter, combo) plus **sparklines**; series/categories bound to datasets/arrays; axes, legend, labels, theming. Rendered as **vector** in the PDF (not a rasterized image) so it stays crisp and selectable where applicable.
- **Crosstab / Pivot** — matrix with row/column groups, measures, and totals/subtotals; a core reporting primitive.
- **Subreport** — embed another template that runs against its own (possibly related/master‑detail) dataset, flowing inline with the parent.
- **PageNumber / PageCount / CurrentDate** — built‑in computed fields (`$page`, `$pageCount`, `now()`); plus running totals and "continued"/carry‑over markers.
- **Spacer / Container (group)** — grouping with optional background/border; groups move/resize together.
- **PageBreak** — explicit break control.

Provide an **element registry** so new element types can be added by consumers without forking (see §12).

---

## 6. Band / Section System (pagination engine)

This is the part that makes it a *report* tool rather than a fixed‑canvas drawer. Implement an ordered set of bands; the layout engine flows them across pages.

Band types (each contains positioned elements; each has a height that is **fixed** or **auto‑grow**):
- `background` / `watermark` — drawn behind every page.
- `reportHeader` — once, at the start.
- `pageHeader` — **repeats at the top of every page**.
- `columnHeader` — top of each column (when columns > 1).
- `groupHeader[]` — emitted when a group key changes (grouping over a dataset).
- `detail` — **repeats once per row** of its bound dataset; may **split across pages**.
- `groupFooter[]` — emitted when a group ends; supports group aggregates.
- `columnFooter`.
- `pageFooter` — **repeats at the bottom of every page**.
- `reportFooter` — once, at the end (final aggregates).

Pagination engine requirements:
- Compute a **layout tree → paginated page list**. Pure function: `(template, data) → Page[]`. No DOM dependency. This is the most heavily unit‑tested module.
- Repeat page header/footer on every page; reserve their space when laying out detail.
- **Auto‑grow** bands and text (height expands to fit content; following bands reflow).
- **Keep‑together**, **page‑break‑before/after**, **orphan/widow**‑style controls per band/element.
- Detail bands that overflow a page continue on the next page under the repeated header.
- Grouping with multi‑level group headers/footers and per‑group aggregates.
- Correct behavior for `$page`, `$pageCount`, `$first`, `$last`, `$index`, `$groupIndex`.
- Deterministic output: same inputs ⇒ byte‑comparable layout (for snapshot testing).

---

## 7. Two Render Targets, One Layout (WYSIWYG)

The cardinal challenge of a PDF designer is that **what you see must equal what you get**. Solve it structurally:

```
Template + Data
      │
      ▼
[ core: Layout & Pagination Engine ]  → produces a Page[] layout tree (geometry + resolved text runs)
      │
      ├────────────► [ Preview Painter ]  → renders Page[] to DOM/SVG for the designer & live preview
      │
      └────────────► [ PDF Painter ]      → renders Page[] to a real PDF (pdf layer)
```

Both painters consume the **same** `Page[]` layout tree. They never recompute layout independently. Any visual divergence is a bug in a painter, not a layout difference. Text measurement must be **consistent between preview and PDF** — measure using the same embedded font metrics in both paths (do not let the browser measure for preview while the PDF measures differently). Document how you guarantee metric parity (this is the make‑or‑break detail).

---

## 8. The Designer (visual editor) — UX & feature requirements

A professional, keyboard‑friendly editor. Components are Angular (`designer` package), state is held in a framework‑agnostic **document store** with an explicit command model. This section lists the *functional* capabilities; **§8A defines the look, feel, and authoring ergonomics — read it as a hard requirement, not a nice‑to‑have.**

Layout: **left toolbox** (draggable element palette) · **center canvas** (rulers, page + bands) · **right inspector** (contextual properties) · **bottom/side outline tree** (page → bands → elements).

Must‑have capabilities:
- **Drag from toolbox onto canvas**; **drag to move**, **handles to resize**, **rotate**.
- **Snap** to grid, to guides, to other elements (smart alignment guides); toggle‑able grid.
- **Multi‑select** (marquee + shift‑click); **align/distribute** (left/center/right/top/middle/bottom, distribute h/v); **group/ungroup**.
- **Z‑order** (bring forward/back, to front/back).
- **Property inspector** driven by element type: geometry, typography, colors, borders, fit modes, the **binding expression** (with an expression editor + field picker fed by declared datasets), format descriptor, conditional visibility.
- **Field picker / data explorer:** browse declared dataset shapes and click to insert `anbar.name`, `items[].price`, etc.
- **Undo / redo** via the **command pattern** (every mutation is a reversible command); full history; coalescing for drag operations.
- **Copy / paste / duplicate**, including across templates.
- **Zoom** (fit, %, ctrl+wheel), **pan**.
- **RTL canvas mode** that mirrors layout direction and rulers.
- **Live preview** toggle: render the current template against **sample data** the author provides/edit in‑panel.
- **Save / load / import / export** template JSON; **validate on import**.
- **Keyboard shortcuts** for all common ops; an a11y pass (focus management, ARIA on toolbox/inspector, no keyboard traps).
- **Rulers + guides**, page/band outline, band height handles.

The designer’s state mutations go exclusively through commands; the rendering reads the document store reactively. **Never** mutate the template tree directly from a component.

---

## 8A. Designer Look, Feel & Authoring Ergonomics — **a primary deliverable**

The functional list in §8 is the floor. This section is what makes the product *good*. Hold it to the same bar as the engine. Litmus test: **a non‑technical author opens the editor, picks a template, drags a few fields, and ships a beautiful PDF in under five minutes without reading docs.** Reference quality bar: Canva, Figma, Webflow.

> If you are unsure where to spend effort, spend it here. Most PDF libraries are engine‑only and miserable to author in; the entire reason this product wins is the authoring experience.

### A. The editor’s own visual design (the chrome)
- **A real design system with design tokens** (color, spacing, radius, elevation, typography scale, motion). Everything themeable from tokens — the editor must be **white‑labelable/brandable** by consumers, not visually hard‑coded.
- **Light and dark themes**, both polished. Respect `prefers-color-scheme` and `prefers-reduced-motion`.
- **Content‑first, low‑chrome layout:** the page being designed is the hero; panels recede (muted surfaces, restrained borders, clear hierarchy). No visual clutter, consistent single icon set, generous hit targets, comfortable density.
- **Build on Angular CDK** primitives (Overlay, Drag‑Drop, A11y/FocusTrap, Virtual Scroll, Portal) under a **custom themeable component layer**. Do **not** ship Angular Material’s default look as the product UI — it must be brandable via tokens.
- **Polished states everywhere:** empty states with guidance, skeleton loaders, smooth (but subtle) transitions, `:focus-visible` styles, hover affordances, disabled/error/loading states for every control.
- **The editor UI itself ships in both Persian and English, equally complete, switchable at runtime** — both with fully translated strings and the chrome flipping LTR↔RTL to match. Neither is a second‑class translation. UI strings come from a swappable i18n provider so consumers can add more languages. The **editor language is independent of the document language**: a user can design an English (LTR) document while using the Persian (RTL) UI, and vice versa. Persist the user’s UI‑language choice.

### B. Effortless authoring — the ergonomics that make designing *feel easy*
These are not optional flourishes; they are the product.

- **Start‑from‑template gallery (highest‑impact item):** a categorized gallery of professional, ready‑made templates — فاکتور/invoice, report, label/برچسب, certificate/گواهی, letterhead/سربرگ, packing list, etc. One click to start, fully editable. **Blank is an option, never the default.** Ship a strong starter set, RTL/Persian versions included.
- **Smart defaults:** every element dropped on the canvas looks good *immediately* — sensible font, size, color, spacing, alignment. The author should rarely need to touch the inspector just to make something not‑ugly.
- **On‑canvas inline editing:** double‑click text to edit in place (true WYSIWYG); edit table cells in place. The inspector is for fine‑tuning, not the only path to change content.
- **Drag‑to‑bind (make dynamic data feel effortless):** drag a field from the **Data Explorer** directly onto the canvas to create a bound `DataField`, or drop it onto an existing element to bind it. Dragging an **array** node offers “create a bound table/list.” Typing `anbar.name` by hand is the power‑user fallback, not the primary flow.
- **Figma‑grade smart snapping with live visual feedback:** alignment guides, equal‑spacing badges, distance‑to‑neighbor/edge measurements shown *while dragging*, snapping to margins, columns, centers, and sibling edges; magnetic guides; nudge with arrow keys (and a larger nudge with Shift).
- **Floating contextual toolbar on selection** (Canva/Figma style): quick font, size, color, weight, alignment, and bind controls right next to the element, so the most common edits never require a trip to the side panel. Plus **right‑click context menus** for structural actions.
- **Command palette (Ctrl/Cmd‑K)** for everything, and **single‑key quick‑add** (e.g. `T` text, `R` rectangle, `I` image, `L` line, `Q` QR). Show a discoverable shortcuts cheat‑sheet.
- **First‑class color & font UX:** color picker with **document theme colors**, recent swatches, hex/RGB input, and an **eyedropper**; font picker with **live preview** and **bundled Persian fonts**; image insertion via **drag‑drop, clipboard paste, or upload**.
- **Preview‑values toggle:** switch the canvas between showing field *names* (`anbar.name`) and live *sample values* from the author’s sample data, so the author designs against realistic content. Show a gentle inline warning when a bound path is missing from the sample data.
- **Reusable snippets / saved components:** save a styled group (e.g. a header block, a signature block) and reuse it across documents; edit‑once propagation where it makes sense.
- **Document theme & style presets:** apply a color + typography theme to the whole document in one action; named styles are globally editable (change a style, every element using it updates).
- **Undo/redo with a visible history**, **autosave**, and **draft recovery** — the author must never lose work. Drag operations coalesce into single undo steps.
- **Zoom & navigation that feel native:** zoom presets, fit‑to‑width / fit‑to‑page, Ctrl/Cmd‑wheel zoom, pinch‑zoom on touch; space‑drag to pan; a minimap for large/multi‑page documents.
- **Touch & tablet support:** fully usable on an iPad — drag, resize, pinch; the editor layout is **responsive**, collapsing panels gracefully (e.g. into drawers) on narrow screens.
- **Guided onboarding:** a lightweight, dismissible first‑run tour plus contextual empty‑state hints. Discoverable, never nagging.
- **Performance is part of the feel:** **60fps** drag/resize/zoom, debounced live preview, no input lag. Jank is treated as a bug, not a cosmetic issue. Virtualize long lists (template gallery, large outlines); keep the canvas smooth with many elements.
- **Accessibility *is* ergonomics:** the entire designer is keyboard‑operable, with screen‑reader labels and correct focus management. A power user should be able to author without a mouse.

### C. Output look quality (so results are beautiful by default)
- Ship **professional bundled themes** for the generated PDF (refined type scale, spacing rhythm, color) so an author who just picks a template + theme gets a polished result with zero manual styling.
- **Design‑quality bar for both canvas and PDF:** pixel‑snapped rendering, consistent spacing rhythm, crisp text at all zoom levels, never clipped/overflowing text, proper kerning/line‑height. Sloppy spacing or misaligned defaults are bugs.

---

## 9. Data Binding & Expression Engine (sandboxed)

Concrete behavior to satisfy the user’s core example: the author defines `anbar.name` in the designer; at render time the consumer passes `{ anbar: { name: "..." }, items: [...] }`; values bind and display; arrays drive repeating bands/tables.

Build a **small, safe expression language** (own Pratt parser or `jsep` + a custom evaluator — **no `eval`/`Function`**):
- **Member access & indexing:** `anbar.name`, `order.lines[0].total`, `customer["full name"]`.
- **Operators:** arithmetic, comparison, logical, ternary `a ? b : c`, null‑coalescing `??`, optional chaining semantics for missing paths (resolve to `null`, never throw).
- **Whitelisted functions only**, e.g.: `sum(arr, expr?)`, `count(arr)`, `avg`, `min`, `max`, `first`, `last`, `concat`, `upper`, `lower`, `if(cond, a, b)`, `now()`, and a **locale‑aware formatting family that covers both languages symmetrically**: `formatNumber(x, opts)`, `formatCurrency(x, opts)`, `formatDate(x, fmt, calendar)` (calendar = `gregorian` or `jalali`), `formatJalali(x, fmt)` / `formatGregorian(x, fmt)`, and digit converters both ways: `toPersianDigits(x)` / `toLatinDigits(x)`. All formatting functions resolve language/digits/calendar from the element’s effective locale unless explicitly overridden in `opts`. Make the function table **extensible/registerable**.
- **Scope chain (resolution order):** built‑in vars (`$index`, `$page`, `$pageCount`, `$first`, `$last`, `$groupIndex`) → current band item (when inside a repeating band, fields resolve against the row, with access to parent/root scope) → declared `parameters` → root `data`. Document precedence precisely.
- **Datasets:** declare datasets in the template (name, optional shape/schema for the field picker, source = a path into the data JSON or a registered provider). A `detail`/table binds to a dataset; iteration sets the row scope.
- **Formatting:** a structured `FormatDescriptor` (kind + locale + options) applied to `DataField`s; locale‑aware, Persian‑aware.
- **Aggregates:** computed over the bound dataset, scoped to report / page / group level (drives footer totals).
- **Error policy:** binding errors are **non‑fatal** — they render a configurable placeholder and are collected into a `RenderDiagnostics` report, never thrown into the consumer’s app.

Provide a clean typed API: `evaluate(expr: CompiledExpression, scope: Scope): unknown` with compilation cached per expression string.

---

## 10. The PDF Engine (`pdf` package)

Output **real PDFs**: selectable/searchable text, embedded & subsetted fonts, vector graphics, images, internal/external links, metadata, compression, configurable page sizes.

**ADR required — choose and justify the rendering stack.** Candidate strategies to evaluate:
1. **`pdf-lib` + `@pdf-lib/fontkit`** for full control of drawing, font embedding & subsetting. You implement layout (you already have it in `core`) and a bidi/shaping step. → Best control, best Persian outcome, most work.
2. **`pdfmake`** — fast to start, but RTL/Persian shaping and custom pagination are weak/awkward. → Likely insufficient for “best‑in‑class.”
3. **`jsPDF` (+ plugins)** — lightweight; manual font/RTL handling. 
4. **Headless‑render** (HTML/SVG → PDF) — strong WYSIWYG, but selectable text + Persian + offline browser‑only constraints make this risky.

State the trade‑offs and pick. Given the RTL/Persian + WYSIWYG + selectable‑text requirements, bias toward **(1)**. Whatever you choose, the painter must consume the `core` `Page[]` layout tree.

Hard requirements regardless of choice:
- **Embed and subset custom fonts** (incl. Persian fonts: e.g. Vazirmatn/IRANSans‑like). Multiple weights/styles. Subsetting to keep file size down.
- **Bidirectional text** (UAX #9): integrate a bidi implementation (e.g. `bidi-js`) so mixed Persian/English/numbers lay out correctly.
- **Persian/Arabic glyph shaping** (contextual joining) — verify your font path actually shapes joined forms in the PDF; do not assume the browser’s shaping carries over.
- **Persian digits** and **Jalali date** rendering in output.
- Vector shapes, dashed strokes, fills, opacity; images (JPEG/PNG); page links & bookmarks; document metadata; output as `Uint8Array` and `Blob`.

---

## 11. Internationalization — Persian **and** English, fully bidirectional (must work end‑to‑end)

Both languages are first‑class and must coexist, including mixed in one document or one line. There is no "primary" language hard‑coded anywhere.

**The i18n resolution model (document → band → element, with `auto`):**
- **Direction** resolves: element `direction` → band → `page.direction`; `'auto'` runs bidi detection on the content. Mixed Persian/English/numbers resolve identically in **preview and PDF** (same bidi engine, same result).
- **Locale** (language / digit system / calendar) resolves the same way: element `locale` overrides band/document `LocaleSetup`. So one document can hold an English LTR title and a Persian RTL body, a Latin invoice number and a Persian total, side by side.
- **Numbers:** Latin (`latn`) or Persian (`persian`) digits, chosen per document or per field; both directions of conversion available (`toPersianDigits`/`toLatinDigits`).
- **Calendars:** Gregorian and Jalali (Shamsi) both supported, chosen per date field. Pick and justify a Jalali lib (e.g. `dayjs` + jalali plugin, or `date-fns-jalali`) in an ADR.

**Fonts & shaping:**
- Bundle at least one quality **Persian font** (e.g. Vazirmatn‑like) **and** a quality **Latin font** as defaults, with the ability to register more. Embedding + subsetting for both.
- Correct **Persian/Arabic contextual shaping** verified in the actual PDF output (not just the browser).

**Editor:** the designer UI is available in both Persian and English, switchable, with matching LTR/RTL chrome, independent of the document’s language (per §8A).

**Required end‑to‑end test (covers both, mixed):** render a template that contains — in the same document — a Persian RTL block (`anbar.name`, Persian‑labelled `items[]` table, Persian digits, a **Jalali** date) **and** an English LTR block (Latin labels, Latin digits, a **Gregorian** date), plus a line that mixes Persian text with an inline English word and a number. Assert the extracted PDF text (content + order in both directions) and a rasterized snapshot. Run the editor‑UI test suite in **both** `fa` and `en`.

---

## 11A. Professional & Enterprise‑Grade Output — **what makes it the best in the space**

Everything above makes a *good* tool. This section is what separates a professional product from a hobby library. Treat each item as required for a 1.0 that claims to be best‑in‑class; where browser‑only JS makes something hard, record an **ADR** and provide a path (often the Node/server route, §3) rather than dropping it.

### A. PDF standards & compliance (enterprise table stakes)
- **Tagged / accessible PDF (PDF/UA, ISO 14289):** emit a logical structure tree (headings, paragraphs, lists, tables with header scopes), correct **reading order**, **alt text** for images/charts, language tags, and artifact marking for decorative elements. Provide an in‑editor **accessibility checker**.
- **PDF/A (ISO 19005)** for archival/legal: support A‑1b/2b/3b at minimum (full font embedding, no transparency violations, XMP required). Author picks the conformance level; the renderer enforces or reports violations.
- **PDF/X** for print production (e.g. PDF/X‑4) with output intent / ICC.
- **Encryption & permissions:** AES‑256, owner/user passwords, and permission flags (print, high‑res print, copy, modify, annotate, fill forms).
- **Digital signatures (PAdES):** signature fields in the designer and a signing step (visible + invisible signatures, timestamp). Critical for invoices/contracts in many jurisdictions. (Likely needs a specific lib and/or the Node path — ADR it.)
- **XMP metadata**, document properties, **linearization (fast web view)**, and explicit **PDF version targeting** (1.4–2.0).
- **AcroForm output (optional):** emit fillable form fields (text, checkbox, radio, dropdown, signature) when the author marks fields as interactive.

### B. Print production & color management
- **CMYK and spot/Pantone colors** alongside RGB — the browser is RGB‑only, so the PDF painter must support a real CMYK/spot color path (the preview approximates; the PDF is accurate). Document the gamut handling.
- **ICC color profiles** and **output intent**; **overprint** control.
- **Bleed, trim, crop/registration marks**, and a configurable **bleed box**; show bleed/safe‑area guides in the designer.
- **Image DPI control & downsampling**, JPEG quality, and color‑space handling per image.

### C. Advanced typography (professional polish)
- **OpenType feature control:** ligatures, kerning, small caps, stylistic sets, and especially **tabular (mono‑spaced) figures** so numeric columns in tables align — a hallmark of professional financial documents.
- **Hyphenation** (locale‑aware, incl. for justified text) with soft‑hyphen and non‑breaking‑space support and manual break controls.
- **Font fallback chains:** when a glyph is missing from the chosen font, fall back through a configured chain (e.g. Persian → Latin → symbol) rather than rendering tofu.
- **High‑quality line breaking** (prefer a Knuth‑Plass‑style optimizer for justified text over naive greedy wrapping); baseline grid / leading control; widow/orphan control.
- **Footnotes/endnotes**, text‑on‑path (nice‑to‑have), and proper bidi mirroring of brackets/punctuation.

### D. Reporting depth (beyond static layout)
- **Auto‑generated table of contents and PDF bookmarks/outline** from document structure; **internal anchors, cross‑references, and hyperlinks/drill‑through**.
- **Running totals / carried‑forward subtotals** across page breaks, "continued on next page" markers, and **balance‑forward** patterns.
- **Conditional formatting:** data bars, color scales, icon sets, and expression‑driven styling (e.g. negative numbers red).
- **Variables with reset scopes** (report/page/group) and **dataset‑level sorting, filtering, and grouping** declared in the template.
- **Master‑detail & subreports**, **crosstabs/pivots**, and **data charts** (per §5).

### E. Document structure at scale
- **Sections with independent page setup** (size, orientation, margins, columns) within one document; **mixed page sizes**.
- **Master pages / page templates:** distinct **first page**, **odd/even (mirrored)** pages, and section‑level page templates; page‑number restart per section.
- **Mail‑merge / batch generation:** render one template across an array of N records to produce N separate PDFs **or** one merged document, efficiently. **Document assembly:** concatenate/merge multiple rendered templates.

### F. Output formats, streaming & scale
- **Primary output PDF**, plus **raster export (PNG/JPEG at chosen DPI)** and **SVG per page**; optional **direct browser print** of the rendered result.
- **Streaming / incremental generation** so very large documents (thousands of pages, large datasets) don't have to be held fully in memory; bounded memory on the Node path.
- **Performance budget:** define and test throughput targets for large reports (e.g. pages/sec, time‑to‑first‑page) and keep generation off the UI thread (worker in browser; streaming on server).

### G. Security & robustness (production‑grade)
- Sandboxed expressions (per §9); **sanitize rich‑text/HTML inputs**; **SSRF protection** and allow‑listing for dynamic image URLs; size/time limits to prevent runaway templates.
- **Font licensing hygiene:** bundle only permissively licensed fonts (e.g. OFL Vazirmatn + a permissive Latin family); document licenses; make font embedding licensing‑aware.
- **Deterministic, reproducible bytes** for identical inputs (already required for snapshot tests and browser/Node parity).

> **Honest scoping note for the implementer:** this is the feature surface of a multi‑year commercial product (think JasperReports/Stimulsoft/DevExpress class). Do **not** attempt it all at once. Deliver the §15 phases first (a complete, beautiful, bilingual designer + engine), then layer §11A capabilities in priority order. Some items (CMYK/spot, PDF/A, PAdES signatures, tagged‑PDF) are genuinely hard in browser‑only JS — each gets its own ADR and may lean on the Node path. Be explicit in docs about which compliance levels are actually verified, and never claim a standard you haven't tested against a validator.

---

## 12. Public API Surface (developer experience)

Make the happy path trivial and the deep path possible.

**Designer (template authoring):**
```ts
// NgModule consumer (Angular 12–14)
@NgModule({ imports: [PdfStudioDesignerModule] })

// Component usage
<pdf-studio-designer
  [(template)]="template"        // two-way bound template JSON
  [sampleData]="sample"          // data used for live preview
  [fonts]="customFonts"
  [config]="designerConfig"
  (templateChange)="onChange($event)"
  (save)="persist($event)">
</pdf-studio-designer>
```

**Rendering (no UI):**
```ts
constructor(private pdf: PdfStudioRenderer) {}

const result = await this.pdf.render({
  template,                      // PdfTemplate
  data: { anbar: { name: 'انبار مرکزی' }, items: [...] },
  parameters: { title: '...' },
});
// result: { bytes: Uint8Array; blob: Blob; pageCount: number; diagnostics: RenderDiagnostics }

// convenience helpers
this.pdf.download(result, 'report.pdf');
this.pdf.open(result);          // open in new tab
const url = this.pdf.toObjectUrl(result);
```

**Preview component (read‑only render):**
```ts
<pdf-studio-preview [template]="template" [data]="data"></pdf-studio-preview>
```

**Professional output options** (opt‑in; sensible defaults):
```ts
const result = await this.pdf.render({
  template, data, parameters,
  output: {
    standard?: 'pdf' | 'pdf-a-2b' | 'pdf-a-3b' | 'pdf-ua' | 'pdf-x-4';
    pdfVersion?: '1.7' | '2.0';
    color?: { space: 'rgb' | 'cmyk'; iccProfile?: Uint8Array; intent?: '...' };
    print?: { bleedMm?: number; cropMarks?: boolean; registrationMarks?: boolean };
    encryption?: { userPassword?: string; ownerPassword?: string; permissions?: PermissionFlags; algo?: 'aes-256' };
    sign?: SignOptions;                  // PAdES
    metadata?: XmpMetadata;
    linearize?: boolean;
    tagged?: boolean;                    // accessible structure
    format?: 'pdf' | 'png' | 'jpeg' | 'svg'; // raster/vector export
    dpi?: number;
  },
});
```

**Batch / mail‑merge & server (Node) usage:**
```ts
// Node entry — same engine, byte-identical output, for server-side generation at scale
import { render, renderBatch } from '@your-scope/pdf-studio/node';

const pdf = await render({ template, data });                 // one document
const many = await renderBatch({ template, records, merge }); // N records → N files or 1 merged
// streaming variant for very large documents:
await renderToStream({ template, data, output }, writableStream);
```

**Extensibility (registries):**
```ts
PdfStudio.registerElement(myCustomElementDef);     // new element type + painter + inspector
PdfStudio.registerFunction('myAgg', fn);           // new expression function
PdfStudio.registerDataProvider('rest', provider);  // custom dataset source (async, paged, parameterized)
PdfStudio.registerFont(fontDescriptor);            // custom/Persian/Latin fonts
PdfStudio.registerChartType(myChartDef);           // custom chart/visual
PdfStudio.registerBarcode(mySymbology);            // custom symbology
```

API rules: stable, documented, semver’d; tree‑shakeable; **no side effects on import** (`"sideEffects": false` honored); barrel `public-api.ts`; everything exported is intentional and TSDoc‑commented; internal types not leaked.

---

## 13. Testing Strategy (this is graded as heavily as the features)

Use **Jest** (the consumer’s standard), not Karma. Layered:

1. **Unit (core/pdf, pure TS) — target ≥ 90% coverage:**
   - Expression engine: parsing, evaluation, scope chain, error policy, every built‑in function, malicious‑input safety (no code execution).
   - Binding & dataset iteration, aggregates, formatting (incl. Persian digits, Jalali).
   - Pagination engine: header/footer repetition, auto‑grow, detail overflow/split, grouping, keep‑together, `$page`/`$pageCount`, deterministic output. **Snapshot the layout tree.**
   - Style resolution order; template (de)serialization round‑trip; schema migration across `schemaVersion`s.

2. **Component / integration (Angular, designer/renderer):**
   - Use Angular TestBed (+ Angular Testing Library if helpful). Test command pattern (undo/redo reversibility), selection, drag/resize reducers, inspector ↔ document store sync.
   - Run the designer test suite against **multiple Angular versions** in CI (at least 12, an LTS mid‑version, and latest) to enforce the compat contract.

3. **PDF golden / snapshot tests:**
   - Render representative templates to PDF; **extract text** (assert content & order, incl. RTL) and **rasterize pages to PNG** and compare against committed goldens with `pixelmatch` + a tolerance. Provide a `--update-goldens` workflow.
   - Include the Persian end‑to‑end fixture from §11.

4. **Accessibility:** automated a11y checks (e.g. axe) on the designer shell.

5. **Coverage gates** enforced in CI (fail under threshold). **CI matrix** covers the Angular version range, lint, format check, unit, integration, and PDF snapshot jobs.

Every bug fixed gets a regression test. No PR merges red.

---

## 14. Code Quality, Conventions & Tooling

- **TypeScript strict** (full strict family as in §2.2). No `any` in public APIs; justify any internal `any` with a comment.
- **ESLint** (angular‑eslint + typescript‑eslint) + **Prettier**; both run in CI and as pre‑commit hooks (husky + lint‑staged).
- **Angular component standards:** `ChangeDetectionStrategy.OnPush` everywhere; `trackBy` on all `*ngFor`; no logic in templates beyond binding; unsubscribe via `takeUntil`/`async` pipe (no leaks); DI for all dependencies; no direct DOM access except via Angular Renderer/CDK where unavoidable.
- **Naming:** descriptive, conventional TS/Angular naming (PascalCase types, camelCase members, kebab‑case selectors prefixed `pdf-studio-`). (Note: the project’s Finglish DB‑naming convention is **DB‑specific** and does **not** apply to this TypeScript codebase — use idiomatic TS naming here.)
- **Conventional Commits**; automated changelog; semantic‑release optional.
- **Docs:** TSDoc on all public symbols; generate API docs (TypeDoc/Compodoc); a `README` with quickstart; a `/docs` guide covering: install per Angular version, authoring a template, the expression language reference, the extensibility registries, and the RTL/Persian guide. Consider **Storybook** for designer components.
- **Performance:** virtualize long lists in the designer; debounce live preview; render PDFs off the main work where possible (Web Worker for heavy layout/PDF if the chosen stack allows — note in ADR); lazy‑load the designer chunk separately from the lightweight renderer so consumers who only render pay no designer cost.

---

## 14A. Packaging & Distribution (publishing to npm)

The deliverable is a **published npm package**, so packaging is part of "done," not an afterthought. Get this right and consumers `npm i` and it just works on Angular 12 → latest.

### Package topology — **decide via ADR (recommend the split)**
Two viable shapes; pick one and justify:
- **A) Single package, multiple entry points** (`@scope/pdf-studio` with `.`, `./node`, optionally `./designer`).
- **B) (Recommended) Core + Angular adapter as separate packages:**
  - `@scope/pdf-studio-core` — the framework‑agnostic engine (`core` + `pdf`), runs in **browser and Node**, usable by non‑Angular consumers too (this widens adoption and is the more professional design).
  - `@scope/pdf-studio` — the Angular library (`designer` + `renderer`) that depends on core.
  
  Either way, the **lightweight render path must be importable without pulling the heavy designer** (so render‑only consumers stay small).

### Build & format
- Build the Angular library with **ng‑packagr** → **Angular Package Format (APF)**: partial‑Ivy, FESM bundles, and `.d.ts` types. **Publish the built `dist/` output, never the source** (`cd dist/<lib> && npm publish`).
- Externalize peers (Angular, RxJS, zone.js) — never bundle them. Bundle/declare runtime deps (pdf‑lib, fontkit, bidi‑js, jalali lib, etc.) correctly (see deps below).

### The library's own `package.json` (separate from the workspace root)
- Identity: scoped `name` (`@scope/pdf-studio`), `version`, `description`, `keywords` (pdf, angular, report, designer, rtl, persian, invoice…), `author`, `license`, `homepage`, `repository`, `bugs`.
- **`peerDependencies`:** `@angular/core` & `@angular/common` with the wide range `">=12 <99"`, plus `rxjs` (`^6 || ^7`) and `zone.js`. Add `peerDependenciesMeta` for anything optional.
- **`dependencies`:** the actual runtime libs that ship to consumers (PDF engine, fontkit, bidi, jalali, barcode/chart libs). Keep this list lean and audited.
- **`exports` map** with proper `types`/`import`/`default` (and a `node` condition) for each entry point (`.`, `./node`, `./designer`); set `sideEffects: false`; correct `types` field. Let APF/ng‑packagr generate module fields.
- **`engines`** (Node version) for the Node entry; `files`/`.npmignore` so only `dist` artifacts, README, LICENSE, and `CHANGELOG` ship (no tests, no source maps unless intended).
- Secondary entry points via ng‑packagr (`./node`, `./designer`) each with their own `ng-package.json`.

### Licensing & fonts (you are redistributing — this is a real legal gate)
- Choose and include a top‑level **LICENSE** (MIT or Apache‑2.0 recommended for libraries).
- **Bundled fonts MUST be redistributable.** Use **Vazirmatn (SIL OFL)** for Persian and a permissive Latin family — **do NOT bundle IRANSans or any non‑redistributable font in a public npm package.** Ship the OFL license text alongside bundled fonts and document it. Prefer making large fonts **optional/loadable** to keep package size down; bundle only sensible defaults.

### Size, types & quality
- **Package‑size budget:** the render‑only entry stays small; the designer is a heavy, separately‑importable chunk. Track install size (bundlephobia/`npm pack --dry-run`) and treat regressions as bugs.
- Ship complete, accurate **type definitions**; verify with a consumer smoke test that imports types on Angular 12 and latest.
- The **playground/docs apps are never published** — they live in the workspace only.

### Release automation & supply‑chain (professional hygiene)
- Automate versioning + `CHANGELOG` with **Changesets** or **semantic‑release** (Conventional Commits).
- CI publish pipeline: build → full test matrix → `npm pack --dry-run` smoke → publish on tag. Use **`npm publish --provenance`** via GitHub Actions OIDC, enforce **2FA**, commit a **lockfile**, and gate on `npm audit`.
- First publish of a scoped public package needs **`--access public`**.
- Optionally ship **`ng update` migration schematics** so consumers upgrade across breaking majors smoothly (a hallmark of a polished Angular library). Maintain strict **SemVer**: breaking changes → major, with a documented deprecation policy.

### Consumer smoke tests (must pass in CI before publish)
Create throwaway apps that install the **packed tarball** (not the workspace) and verify it builds and runs on **Angular 12, a mid LTS, and latest** — both the NgModule and standalone import paths, and a Node‑side `render()` import. This is the real proof the published artifact works.

---

## 15. Phased Delivery Plan

Deliver in vertical, demoable slices. End each phase with: passing tests, updated docs, a playground demo of the new capability, and any ADRs.

- **Phase 0 — Foundations:** workspace, library/app split, lint/format/test/CI, Angular‑12‑compat harness, empty publishable package built with ng‑packagr (APF), the **package‑topology ADR (§14A)**, correct library `package.json`/`exports`/peer ranges, LICENSE, and a **tarball install smoke test** (install the packed `dist` into throwaway apps on Angular 12 + latest), ADR template. *DoD:* the packed tarball installs and builds from npm‑style consumption on Angular 12 **and** latest.
- **Phase 1 — Model & engines (no UI):** template schema + validator + migration; expression engine; binding; **pagination engine**; both painters’ interfaces; PDF painter MVP (static text + shapes + one embedded font) producing a real PDF; preview painter MVP; **Node entry point with byte‑identical output** to the browser. *DoD:* render a hand‑written template JSON + data to a correct PDF & DOM preview from the same layout tree, in both browser and Node with identical bytes; engine coverage ≥ 90%.
- **Phase 2 — Dynamic data & bands:** DataField binding (`anbar.name`), Table & List bound to arrays, repeating page header/footer, detail overflow/split, aggregates, formatting. *DoD:* the user’s core scenario (define fields → pass JSON → bound multi‑page PDF with repeating header/footer and an array table) works end‑to‑end with tests.
- **Phase 3 — Internationalization (Persian + English, bidirectional):** bidi + Persian shaping; bundled Persian **and** Latin fonts; Latin/Persian digits both ways; Gregorian **and** Jalali calendars; the document/band/element locale + direction resolution model; the mixed‑language §11 e2e fixture. *DoD:* the bilingual + mixed e2e PDF snapshot + text‑extraction tests pass in both directions.
- **Phase 4 — The Designer (core):** canvas, toolbox, inspector, outline, drag/resize/rotate, snap/align, multi‑select/group, z‑order, undo/redo (commands), field picker, save/load/import/export, live preview, zoom/pan, keyboard + a11y. *DoD:* author the Phase‑2 template entirely in the UI; component tests + a11y pass; designer suite runs on the Angular CI matrix.
- **Phase 4A — Designer craft & ergonomics (§8A):** design‑token system + light/dark + Persian/RTL editor UI; on‑canvas inline editing; **drag‑to‑bind** from the data explorer; Figma‑grade smart snapping with live measurement/spacing feedback; floating contextual toolbar + context menus; command palette + quick‑add shortcuts; color/font/image UX (swatches, eyedropper, font preview, paste/drop); preview‑values toggle; autosave + draft recovery; touch/responsive layout; onboarding. *DoD:* the five‑minute litmus test passes with a real non‑technical tester; 60fps drag verified; editor is fully keyboard‑ and screen‑reader‑operable; UI renders correctly in Persian/RTL.
- **Phase 4B — Starter templates & themes:** the template gallery (invoice/فاکتور, report, label, certificate, letterhead, packing list — incl. RTL/Persian versions) and bundled professional output themes; reusable snippets/saved components; document‑wide style/theme presets. *DoD:* a user produces a polished PDF starting only from a gallery template, with no manual styling.
- **Phase 5 — Advanced elements & extensibility:** barcodes/QR, rich text, grouping bands, conditional visibility, the registry APIs (elements/functions/data providers/fonts), watermark/background, columns. *DoD:* a custom element + custom function added via public API in a test, no fork needed.
- **Phase 5A — Reporting depth (§11A‑D):** data charts + sparklines (vector), crosstabs/pivots, subreports, master‑detail, running totals/carry‑forward, auto ToC + bookmarks, cross‑references/hyperlinks, conditional formatting, dataset sort/filter/group. *DoD:* a real financial report (grouped, with charts, subtotals carried across pages, and a generated ToC) renders correctly with tests.
- **Phase 5B — Document structure & batch (§11A‑E/F):** sections with independent page setup, master pages (first/odd‑even), mixed page sizes, mail‑merge/batch generation (N records → N files or merged), document assembly, raster/SVG export, streaming for large docs. *DoD:* batch‑render 1,000 invoices on the Node path within a stated performance budget; mixed‑section document renders correctly.
- **Phase 5C — Standards, print & compliance (§11A‑A/B/C, hardest):** tagged/accessible PDF + in‑editor checker, PDF/A (A‑2b/3b) with validator‑verified conformance, encryption + permissions, PAdES digital signatures, XMP/linearization, CMYK/spot + ICC + bleed/crop marks, advanced typography (OpenType features incl. tabular figures, hyphenation, fallback chains, optimized line breaking). Each sub‑item carries its own ADR. *DoD:* output passes an external **PDF/A and PDF/UA validator**; a CMYK print‑ready PDF with bleed/crop marks verified; a signed PDF verifies in a standard reader.
- **Phase 6 — Polish & release:** performance pass (virtualization, worker rendering, lazy designer chunk), full docs site, Storybook, golden‑snapshot suite finalized, the full **§14A publish pipeline** (changelog automation, `npm publish --provenance` + 2FA via CI, consumer tarball smoke tests), semver `1.0.0`. *DoD:* green CI matrix, all coverage gates met, published package installs and runs from npm on Angular 12 → latest (NgModule + standalone) and via the Node entry.

---

## 16. Definition of Done (global)

A unit of work is done only when **all** hold:
1. Meets the spec and its phase DoD.
2. Tests written and green (unit + integration +, where relevant, PDF snapshot); coverage gates satisfied.
3. Lint + format + type‑check clean under full strict mode.
4. Verified on Angular 12 **and** latest (designer changes: on the CI version matrix).
5. Public API TSDoc’d; docs and playground updated; ADRs recorded for any non‑obvious decision.
6. No memory leaks, no `any` leaks, no `eval`, no direct template‑tree mutation outside commands.
7. Bilingual behavior verified where the change touches text/layout — Persian **and** English, including mixed‑direction content, in both preview and PDF.
8. **For any designer change: it looks polished (matches the design tokens), feels effortless (no jank, sensible defaults, minimal clicks), and works in the Persian/RTL editor UI.** A feature that is functionally correct but awkward to use is not done.

---

### First action
Before writing feature code: produce **(a)** the workspace + tooling + Angular‑12 compat harness (Phase 0), **(b)** the initial ADRs (PDF stack, Jalali lib, bidi/shaping lib, state/command model), and **(c)** the fully‑typed `PdfTemplate` schema with its validator and a round‑trip test. Then proceed phase by phase. Keep changes small and reviewable, and call out any ambiguity in this spec rather than guessing.
