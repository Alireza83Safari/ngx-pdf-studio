# Changelog

All notable changes to `@ngx-pdf-studio/core` and `@ngx-pdf-studio/angular` are
recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Both packages are cut from the same git tag and share one version line: the
Angular bindings compile against a specific engine API, so they are never
released out of lockstep.

## [Unreleased]

Nothing has been published to npm yet. The first tag (`v0.1.0`) will move the
entries below into a released section.

### Added

- Pagination now reports a **band overflow** as a diagnostic. A `fixed` band
  keeps its declared height however tall its content is (and an `auto` band is
  clamped by `max`), so anything positioned below that line was still painted —
  on top of whichever band followed it, in complete silence. A report header 60pt
  tall with an element at `y: 200` put that element 140pt _below_ the content of
  the band after it, and `diagnostics` came back empty. The engine now emits one
  `warning` per offending band naming both heights, so `renderToFile` and
  `renderBatch` callers see the authoring mistake instead of shipping a scrambled
  document. `background` and `watermark` bands are exempt: they reserve no flow
  height by contract and are meant to span the page.

- `@ngx-pdf-studio/core` is now a **dual-format package**. It shipped CommonJS
  only, which no bundler can statically analyse: every Angular application
  consuming it got "CommonJS or AMD dependencies can cause optimization
  bailouts" and shipped engine code it could have tree-shaken away. The same
  sources are now also emitted as real ES modules under `dist/esm/`, selected by
  the `import` condition, with declarations per condition so `node16` resolution
  reads ESM types for the ESM entry. Cost: 379 kB → 411 kB packed, and a
  consumer only ever ships one of the two.

  `@ngx-pdf-studio/core/node` stays CommonJS on purpose — it resolves the
  bundled fonts with `__dirname`, which does not exist in an ES module. It is
  the server-side entry, so there is no bundle to optimize, and Node reads its
  named exports from CommonJS fine.

- Release readiness: `repository`, `homepage`, `bugs` and `author` metadata on
  both packages. `npm publish --provenance` requires `repository.url`, so the
  release workflow could not have succeeded without it.
- `@ngx-pdf-studio/angular` is now published by `release.yml` alongside the
  engine, via `tools/prepare-angular-dist.mjs` (pins its `@ngx-pdf-studio/core`
  dependency to `^<version>` and copies `LICENSE`/`README.md` into the dist).
- The release workflow type-checks a pristine Angular consumer against the
  freshly stamped tarballs before publishing.
- `tools/smoke-angular-linker.mjs` — runs the **real** partial-Ivy linker (the
  same `createEs2015LinkerPlugin` the Angular CLI uses) from a given
  `@angular/compiler-cli` version over the built fesm2022 bundle. The existing
  consumer smoke test checks types only, and declarations carry no Angular
  version, so it passed for majors that could not build the package at all — the
  CI matrix was green on Angular 12 while the artifact was unusable there. CI now
  runs the linker across 14/17/latest, and a separate job asserts Angular 13
  still **fails**, so the documented floor cannot drift unnoticed.
- `smoke:tarball` now exercises both halves of the published package: `require`
  of the Node subpath renders a Persian PDF, and `import` of the main entry
  renders SVG. It asserts the specifier _resolves into_ `esm/`, since importing
  named exports alone would pass against a CommonJS entry too and the bailout
  would come back unnoticed.
- `.gitattributes` normalizing text to LF, so `format:check` behaves the same on
  Windows as in CI.
- This changelog and a security policy.

### Changed

- **`@ngx-pdf-studio/angular` now declares Angular 14 as its floor, not 12.**
  ng-packagr stamps its partial-Ivy declarations `minVersion: "14.0.0"`, and
  Angular 12/13 refuse to link them: _"this application depends upon a library
  published using Angular version 17.3.12, which requires Angular version 14.0.0
  or newer to work correctly."_ The old `>=12.0.0` peer range let npm install the
  package happily and then fail at build time. Verified by running the real
  linker against every major: 12 ✗, 13 ✗, 14 ✓, 15 ✓, 16 ✓, 17 ✓.
- `rxjs` dropped from `@ngx-pdf-studio/angular`'s peer dependencies — the package
  does not import it. It returns when the designer entry point lands.
- The core tarball no longer ships source maps. They referenced `../src/*.ts`,
  which is not published, so every one of them resolved to nothing: 104 files and
  364 kB of "source not found". 525 → 421 files, 411.8 → 337.6 kB packed. The ESM
  half already did this; the CommonJS half inherited `sourceMap: true` from
  `tsconfig.base.json`.
- `build:core` now cleans `dist/` and the build-info file first. `tsc -b` keeps
  its `.tsbuildinfo` next to the config, not in `dist`, so stale outputs (like
  those source maps) survived a rebuild and would have been published.
- `FontkitTextMeasurer` — the measurer every PDF render goes through — is back
  under the coverage gate. It had been excluded from `collectCoverageFrom`
  pending a bundled font; Vazirmatn has been bundled since Phase 3.

### Fixed

- `PdfStudioRenderer.download()` revoked the object URL in the same tick as
  `click()`, which cancels the download outright in Firefox and Safari. It is
  now released on a later task.
- `PdfStudioRenderer.open()` never revoked its object URL, pinning the whole
  rendered PDF in memory for the life of the page. It now releases the URL once
  the new tab has had time to load, and returns the opened `Window` (or `null`
  when a popup blocker refuses it).
- `<pdf-studio-preview>` had no `parameters` input, so a template reading
  `$parameters` previewed differently from the PDF it produced — the exact
  mismatch the component exists to rule out (§7).
- `fontkit-measurer.spec.ts` guarded a hard-coded Linux system font path with
  `existsSync`, but `describe.skip` still executes the callback body, so the
  `readFileSync` threw and took the whole suite down on Windows and macOS. It
  now measures the repository's own bundled Vazirmatn and runs everywhere.
- The two byte-determinism tests overran their 60s cap on a loaded machine
  (observed 103–115s). They render the bilingual fixture twice with real font
  subsetting and contend for the same cores, so the cap is now 180s: they
  measure determinism, not speed, and a timeout there would abort a release.
- `smoke-tarball.mjs` and `smoke-angular-consumer.mjs` could not spawn npm on
  Windows — it ships as `npm.cmd`, which Node refuses to launch without a shell
  since the CVE-2024-27980 fix. Both now shell out on Windows only, quoting
  arguments; the POSIX path is unchanged.

[Unreleased]: https://github.com/Alireza83Safari/ngx-pdf-studio/commits/master
