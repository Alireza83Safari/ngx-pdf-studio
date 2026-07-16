# ADR-0002: Jalali (Shamsi) calendar library

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Principal engineer
- **Related:** spec §4 (LocaleSetup), §9 (formatting fns), §11 (calendars)

## Context

Dates must format in both **Gregorian** and **Jalali (Shamsi)** calendars,
chosen per document / band / element / field. We need: Gregorian↔Jalali
conversion, Jalali-aware formatting tokens, and the ability to combine with
Persian-digit output. Constraints: pure JS (runs in `core`, browser + Node),
small footprint, permissive license, deterministic, no reliance on `Intl`
calendar support (inconsistent across the Angular-12-era runtimes we must run on).

## Decision

Use **`date-fns-jalali`** as the Jalali engine, wrapped behind our own
`CalendarService` interface so the rest of `core` never imports it directly.

## Options considered

- **`date-fns-jalali`** (chosen) — mirrors the `date-fns` API, **tree-shakeable
  pure functions** (no global mutation), immutable, MIT-licensed, deterministic,
  works in Node and browser. Pairs naturally with `date-fns` for Gregorian so we
  get one consistent formatting-token vocabulary across both calendars.
- **`dayjs` + `jalaliday`/`jalali` plugin** — tiny core, but the calendar plugin
  ecosystem is less rigorous, plugins mutate the dayjs instance (global state,
  bad for determinism/parity), and token coverage is thinner.
- **`moment-jalaali`** — mature but built on Moment, which is large, mutable, and
  in maintenance mode. Rejected on size + direction-of-travel.
- **Hand-rolled conversion** — the Jalali↔Gregorian algorithm is well known and
  small, but reimplementing formatting/parsing is wasted effort and a bug farm.

## Consequences

- **Positive:** one mental model (`date-fns` tokens) for both calendars;
  tree-shakeable so render-only consumers pay only for what they use;
  deterministic and SSR-safe.
- **Negative / costs:** two date libs (`date-fns` + `date-fns-jalali`) in the
  dependency list; we must keep their versions aligned.
- **Risks & mitigations:** wrapping both behind `CalendarService` means we can
  swap the implementation without touching call sites, and lets us pin a single
  source of truth for "today" (injected, never `new Date()` inside `core`) so
  output stays deterministic and testable.
- **Revisit when:** `Intl` calendar/`Temporal` support is reliably available
  across the full supported runtime range, at which point a native path may
  shrink the dependency surface.

## Amendment (2026-06-24): determinism technique

`date-fns` `format()` reads a Date's **local** components, which would make
output timezone-dependent and break browser/Node byte parity (§3). Resolution:
before formatting, re-project the value's **UTC** components onto a local-time
Date (`new Date(d.getUTCFullYear(), d.getUTCMonth(), …)`) and format that. No
conversion crosses a timezone boundary, so the rendered digits are independent
of the host timezone. Implemented in `core/src/i18n/calendar.ts`. Installed
versions: `date-fns@4.1.0`, `date-fns-jalali@4.1.0-0`.
