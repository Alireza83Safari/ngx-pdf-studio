# RTL / Persian guide

First-class Persian output is a core requirement (§11), not an add-on. This
guide covers what the engine does automatically and the few things you choose.

## What the engine handles for you

- **Bidi (UAX #9)** — every text run is segmented with `bidi-js` and drawn in
  visual order, so mixed Persian/English/number lines come out correctly in both
  painters (ADR-0003).
- **Shaping** — Arabic-script joining and ligatures happen in the PDF via
  fontkit during font subsetting; the preview relies on the browser's shaping.
  A pdfjs _golden test_ extracts text back out of the PDF and asserts the §11
  fixture (Persian + English + digits + Jalali date) round-trips.
- **Digit runs inside RTL** — Persian/Arabic-Indic digit sequences are kept in
  the correct visual order in the PDF (a fontkit quirk the painter compensates
  for — regression-tested).
- **Jalali calendar** — `format: { kind: 'date' }` renders `۱۴۰۵/۰۴/۰۳` when the
  effective locale is `calendar: 'jalali'`, using date-fns-jalali,
  deterministically (UTC-as-local).
- **Persian digits** — `digits: 'persian'` transliterates formatted numbers,
  dates, and page numbers; expression sources may _contain_ Persian digits too.

## What you choose

### 1. Direction

```jsonc
"page": { "direction": "rtl", … }
```

`direction` cascades page → band → element and can be `'auto'` on an element to
follow its content. Tables/lists mirror column order and alignment under RTL;
data bars grow from the right edge; the designer canvas mirrors likewise.

### 2. Locale

```jsonc
"locale": { "language": "fa", "digits": "persian", "calendar": "jalali" }
```

Overridable per band and per element (`locale: { digits: 'latn' }` on a single
field is fine — e.g. keep invoice numbers Latin).

### 3. Font

WinAnsi base fonts cannot encode Persian. Embed a real font and reference it:

```js
// Node — the OFL Vazirmatn family ships inside the package
const fonts = loadBundledVazirmatn(); // Regular + Bold
await renderToFile(template, { data }, 'out.pdf', { pdf: { fonts } });
```

```jsonc
"typography": { "fontFamily": "Vazirmatn", "fontSize": 12 }
```

In the browser, fetch/bundle the TTF yourself and pass `{ family, bytes }`.
Form-field appearances are also generated with the embedded font, so fillable
fields with Persian defaults work.

### 4. Kashida justification

Set `typography.align: 'justify'` on a text element: wrapped Persian lines
(all but the last) are stretched to the element width by elongating letter
joins with tatweel (ـ) — real Persian typesetting, not stretched spaces.
One elongation point per word (the last legal junction); Latin lines are
left unchanged. Both painters render the same elongated string, so the
preview matches the PDF exactly.

### 5. Alignment

`typography.align` is _logical_: `start`/`end` follow direction (`start` = right
under RTL), `left`/`right`/`center` are physical. Prefer logical alignment in
templates that must serve both directions.

### 6. Coordinates

`bounds.x` is **physical**: x=0 is the left paper edge whatever the direction.
That makes an RTL document awkward to author — the title of a Persian invoice
belongs at the right, so it has to be placed at `contentWidth - width`, and each
label/value pair reads backwards in the source. Templates written the natural
way come out mirrored.

Set `page.coordinates: 'logical'` and x=0 becomes the **start** edge instead, so
the page is authored the way it reads:

```ts
page: { /* … */ direction: 'rtl', coordinates: 'logical' },
// x=0 is the right edge; the label comes before the value it belongs to
elements: [label('نام:', { x: 0, width: 60 }), field('customer.name', { x: 60, width: 200 })],
```

The engine mirrors it to physical once, before layout, so both painters agree.
Children of containers and list item templates mirror against their own box, and
multi-column pages mirror against the column width. On an LTR page logical and
physical are identical, so the flag is safe to set unconditionally. It is a
per-page convention: a band's own `direction` override affects text, not
coordinates.

Omit it (or set `'physical'`) and nothing changes — every template written
before the flag existed keeps its geometry.

## Checklist for a correct Persian document

1. `page.direction: 'rtl'`.
2. `locale: { language: 'fa', digits: 'persian', calendar: 'jalali' }`.
3. Embed Vazirmatn (or your brand font) and set `fontFamily` on text styles.
4. Use logical `start`/`end` alignment.
5. Author positions with `page.coordinates: 'logical'` so the source reads in
   the same order as the page.
6. Check `result.diagnostics` — encoding problems surface there as warnings,
   never as crashes.
