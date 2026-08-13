# Contributing

Thanks for looking. This is a report engine and a visual designer, and the two
have different rules — most of what follows is about which side of the line you
are on.

## Getting set up

```bash
npm install
npm test                 # the whole suite: core, angular, designer, render-service
npm run designer:build   # then open apps/playground/designer/designer.html
```

Node 18.13+ (CI runs 18, 20 and 22).

## The gates

Run these before you push. CI runs all of them, on three Node versions, and the
release workflow runs them again before anything reaches npm.

```bash
npm run lint
npm run format:check
npm run typecheck
npx jest --coverage          # ≥90% statements, or the build fails
npm run designer:smoke       # the designer, in jsdom
npm run smoke:docs           # docs/index.html, in jsdom
npm run build                # both packages, as published
npm run smoke:tarball        # pack the dist and render from a pristine install
npm run smoke:render-service # the HTTP service, end to end
```

`npm run format` fixes formatting; nothing else auto-fixes.

## The invariants

These are not style preferences. Breaking one is a design change, and the
[ADRs](docs/adr/) are where that conversation happens.

1. **`core` contains zero Angular** and runs unchanged in Node. The lint config
   and [ADR-0005](docs/adr/0005-package-topology.md) both hold this line.
2. **No `eval`, no `new Function`.** Expressions go through a lexer, a Pratt
   parser and an evaluator over a whitelisted function table. ESLint fails the
   build on either construct, so this cannot regress quietly.
3. **Output is byte-deterministic.** The same template and data produce
   identical PDFs. `core` reads no clock and no environment — timestamps are
   injected by the caller. If your change makes output depend on anything else,
   it is a bug, and the snapshot tests will say so.
4. **WYSIWYG by construction.** One layout tree feeds both the SVG preview and
   the PDF. A fix that touches only one painter is usually a fix in the wrong
   place: if the two can disagree, they eventually will.
5. **Errors are diagnostics, not exceptions.** An expression that fails, a font
   that is missing, a dataset that does not resolve — all of these produce a
   document plus a `diagnostic`. The exceptions are resource limits
   (`LayoutLimitError`), where the alternative is a truncated document
   pretending to be a whole one.

## Tests

Every change lands with tests. Two things this repo cares about more than most:

- **Assert the thing, not a proxy for it.** The Angular floor is proved by
  running the real linker, not by type-checking a `.d.ts` — declarations carry
  no version, so the type check would pass for majors that cannot build the
  package at all. Look for the equivalent trap in what you are testing.
- **A negative test has to fail for the right reason.** `tools/` has several
  checks that assert something _fails_; each one also insists on the specific
  error, because a broken probe exits nonzero too and otherwise reads as proof.

## Commits

English, imperative, and the body explains _why_ — what was wrong, what it cost,
why this fix and not another. The diff already shows what changed; the message
is for the person who finds this commit in a year while bisecting.

Persian is fine and expected in user-facing copy, the designer UI, and the
planning documents (`TODO.md`, `ROADMAP.md`, `DESIGNER-UX-TODO.md`).

## Documentation

If you add or rename a doc, update [docs/README.md](docs/README.md) in the same
change. If you make a decision that a future reader would otherwise have to
reverse-engineer, write an ADR — the template is
[docs/adr/0000-adr-template.md](docs/adr/0000-adr-template.md).

## Security

Please do not open a public issue for a security problem. See
[SECURITY.md](SECURITY.md) for private reporting and for the threat model,
which is worth reading before you touch validation, the expression engine, or
either painter.
