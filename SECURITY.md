# Security Policy

## Supported versions

Nothing has been published to npm yet. Once `v0.1.0` is tagged, the latest minor
release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it through
[GitHub's private vulnerability reporting](https://github.com/Alireza83Safari/ngx-pdf-studio/security/advisories/new),
or by email to <alireza83safarii@gmail.com>. Include a description, affected
version, and a template or snippet that reproduces it if you have one.

You can expect an acknowledgement within a week, and an assessment with a fix
timeline within two.

## Threat model — what this library assumes

Knowing where the trust boundaries sit makes reports far easier to triage.

### Templates are code-shaped input

A `PdfTemplate` carries **expressions**, which the engine evaluates. They are
never `eval`'d: expressions go through a lexer, a Pratt parser, and an evaluator
over a whitelisted function table, with a nesting-depth cap and an evaluation
step budget. Bare identifiers resolve through an explicit scope chain, so an
expression cannot reach host globals.

That said, a template from an untrusted source is still untrusted input. If your
application lets users upload or author templates, validate with
`validateTemplate` and treat a rejected result as fatal.

### SVG preview is rendered as trusted HTML

`<pdf-studio-preview>` renders the engine's SVG through
`DomSanitizer.bypassSecurityTrustHtml`, because Angular's sanitizer strips the
SVG the painter emits. The painter XML-escapes every text value it writes.

The one value that is **not** interpreted — only escaped — is an image
element's `source` URL, which lands in an SVG `href`. If you preview templates
authored by untrusted users, restrict image sources to schemes you accept
(`data:` and `https:` are the usual answer) before rendering.

### The engine performs no network I/O

Layout and both painters are pure: they never fetch, and an image `source` URL
is embedded, not resolved. The only outbound requests in the package come from
the optional AI copilot providers in `copilot/`, which call the endpoint you
configure with the key you supply. Nothing is transmitted unless you construct a
provider.

### Rendering is deterministic and offline

The same template plus the same data produces byte-identical PDFs. `core` reads
no clock and no environment: timestamps are injected by the caller.

## Dependency policy

CI gates `npm audit --omit=dev --audit-level=high` against the published
package's runtime dependency tree on every push, pull request, and release. The
Angular toolchain is a dev/peer dependency — consumers bring their own Angular —
so it is not part of that gate.
