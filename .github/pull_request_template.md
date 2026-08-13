## What and why

<!-- What was wrong, and what this does about it. The diff shows what changed;
     this is for whoever finds the commit later while bisecting. -->

## Gates

<!-- CI runs all of these. Ticking them before you push is faster than finding
     out from a red build twenty minutes later. -->

- [ ] `npm run lint` and `npm run format:check`
- [ ] `npm run typecheck`
- [ ] `npx jest --coverage`
- [ ] `npm run designer:smoke` (if the designer changed)
- [ ] `npm run smoke:render-service` (if the service or `core` changed)

## Invariants

<!-- See CONTRIBUTING.md. Untick anything this PR deliberately changes and say
     why in the description — these are design decisions, not preferences. -->

- [ ] `core` still contains no Angular
- [ ] No `eval` / `new Function`
- [ ] Output is still byte-deterministic for the same input
- [ ] The SVG preview and the PDF still agree
- [ ] Failures are still diagnostics, not thrown exceptions

## Docs

- [ ] `docs/README.md` updated if a doc was added, renamed, or changed scope
- [ ] An ADR added if this decides something a future reader would have to
      reverse-engineer
