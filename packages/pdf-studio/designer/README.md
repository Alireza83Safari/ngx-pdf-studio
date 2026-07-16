# designer (entry point of `@ngx-pdf-studio/angular`)

The visual editor: canvas, toolbox, inspector, outline, command-driven
`DocumentStore` (ADR-0004), drag-to-bind, smart snapping, floating toolbar,
command palette, themeable design-token UI, bilingual (fa/en) RTL/LTR chrome
(§8, §8A). The **heavy** entry point — separately importable so it is not
pulled by render-only consumers (ADR-0005). Angular-12-safe (§2.1); built on
Angular CDK under a custom themeable component layer.

**Status:** scaffolded. Lands in **Phase 4** (core editor) and **Phase 4A**
(craft & ergonomics).
