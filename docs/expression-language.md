# Expression language reference

Every `Expression` property in a template is `{ source: '<expr>' }`, evaluated
by a **sandboxed** engine (no `eval`, no `Function`, no host access — ADR/§2.3).
Errors never throw into rendering: bad expressions produce `null` plus a
non-fatal diagnostic.

## Literals & operators

| Kind            | Syntax                                                 |
| --------------- | ------------------------------------------------------ |
| Numbers         | `42`, `3.14` (Persian digits accepted in source: `۴۲`) |
| Strings         | `'single'` or `"double"` quotes, `+` concatenates      |
| Booleans / null | `true`, `false`, `null`                                |
| Arithmetic      | `+ - * / %`                                            |
| Comparison      | `== != < <= > >=`                                      |
| Logic           | `&& \|\| !`                                            |
| Null-coalescing | `a ?? 'fallback'`                                      |
| Conditional     | `qty > 10 ? 'wholesale' : 'retail'`                    |
| Member / index  | `customer.name`, `items[0].price`                      |
| Grouping        | `( … )`                                                |

## Scope resolution

Bare identifiers resolve in this order (§9):

1. **Built-in variables** — `$index`, `$first`, `$last` (detail rows), `$page`,
   `$pageCount` (page header/footer), `$group` (rows of the current group),
   `$groupKey`, `$groupIndex`, `$vars.<name>` (report variables), `$item`
   (inside aggregate per-item expressions), `$root` (whole data object),
   `$parameters`.
2. **Current row** — fields of the detail/table/list row, innermost first.
3. **Parameters** — declared template `parameters`.
4. **Root data** — top-level keys of the data JSON.

## Functions (whitelisted)

| Function                                  | Notes                                                               |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `sum(list, expr?)`                        | `sum(items, qty * price)` — `expr` evaluated per row (lazy).        |
| `avg(list, expr?)` / `min` / `max`        | Same shape as `sum`.                                                |
| `count(list)`                             | Array length (also `len(list)`).                                    |
| `first(list)` / `last(list)`              | First/last element.                                                 |
| `slice(list, start, end?)`                | Running totals: `sum(slice($root.items, 0, $index + 1), amount)`.   |
| `abs(n)` / `round(n, digits?)`            | Numeric helpers.                                                    |
| `concat(a, b, …)`                         | String concatenation (or use `+`).                                  |
| `upper(s)` / `lower(s)`                   | Case mapping.                                                       |
| `if(cond, then, else)`                    | Function form of the conditional.                                   |
| `now()`                                   | Injected render timestamp (deterministic in tests).                 |
| `toPersianDigits(s)` / `toLatinDigits(s)` | Digit transliteration.                                              |
| `formatNumber(n, opts?)`                  | Locale-aware grouping/decimals; `opts.digits: 'persian' \| 'latn'`. |
| `formatCurrency(n, opts?)`                | Currency formatting on top of `formatNumber`.                       |

Custom functions can be registered on the function registry without forking (§12).

## Report variables

Declare running accumulators once on the template and read them anywhere as
`$vars.<name>`:

```jsonc
"variables": [
  { "name": "runningTotal", "expression": { "source": "amount" }, "calculation": "sum" },
  { "name": "catTotal", "expression": { "source": "amount" },
    "calculation": "sum", "reset": "group", "resetGroupLevel": 0 }
]
```

`calculation`: `sum | count | avg | min | max | first | last` —
`reset`: `report` (default) or `group`.

## Formatting values

`dataField.format` applies locale-aware formatting after evaluation:

```jsonc
{ "kind": "number", "minimumFractionDigits": 0 }
{ "kind": "currency", "currencyDisplay": "symbol" }
{ "kind": "percent" }
{ "kind": "money", "options": { "unit": "toman", "negativeParentheses": true } }  // ۱٬۲۳۴ تومان
{ "kind": "date", "dateStyle": "medium" }   // Jalali or Gregorian per locale
```

Digits (`latn`/`persian`) and calendar follow the effective locale
(page → band → element).
