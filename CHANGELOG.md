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

- Release readiness: `repository`, `homepage`, `bugs` and `author` metadata on
  both packages. `npm publish --provenance` requires `repository.url`, so the
  release workflow could not have succeeded without it.
- `@ngx-pdf-studio/angular` is now published by `release.yml` alongside the
  engine, via `tools/prepare-angular-dist.mjs` (pins its `@ngx-pdf-studio/core`
  dependency to `^<version>` and copies `LICENSE`/`README.md` into the dist).
- The release workflow type-checks a pristine Angular consumer against the
  freshly stamped tarballs before publishing.
- `.gitattributes` normalizing text to LF, so `format:check` behaves the same on
  Windows as in CI.
- This changelog and a security policy.

### Changed

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
