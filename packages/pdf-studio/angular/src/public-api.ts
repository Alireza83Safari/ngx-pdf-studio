/**
 * Public API of `@ngx-pdf-studio/angular` — the Angular bindings.
 *
 * Phase-4 surface: the render service and read-only preview component (§12).
 * The visual designer (`<pdf-studio-designer>`) is a separate, heavier entry
 * point added in a later phase so render-only consumers stay small (ADR-0005).
 */
export { PdfStudioRenderer } from './lib/pdf-studio-renderer.service';
export type {
  PdfRenderRequest,
  PdfStudioResult,
  SvgRenderResult,
} from './lib/pdf-studio-renderer.service';
export { PdfStudioPreviewComponent } from './lib/pdf-studio-preview.component';
export { PdfStudioRendererModule } from './lib/pdf-studio-renderer.module';
