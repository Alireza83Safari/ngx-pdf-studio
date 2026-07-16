# renderer (entry point of `@ngx-pdf-studio/angular`)

Angular-facing render service (`PdfStudioRenderer`) and read-only
`<pdf-studio-preview>` component (§12). The **lightweight** entry point —
importable without the heavy designer so render-only consumers stay small
(ADR-0005). Angular-12-safe: NgModule delivery, `*ngIf`/`*ngFor`, constructor
DI, no Signals (§2.1).

**Status:** scaffolded. Lands in **Phase 1** (preview painter MVP) and **Phase
2** (render service over the engine).
