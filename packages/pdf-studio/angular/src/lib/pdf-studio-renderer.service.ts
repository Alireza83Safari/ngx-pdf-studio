import { Injectable } from '@angular/core';
import {
  renderToPdf,
  renderToSvg,
  type ExpressionDiagnostic,
  type PdfTemplate,
  type RenderOptions,
} from '@ngx-pdf-studio/core';

/** A render request: a template plus the data/parameters to bind (§12). */
export interface PdfRenderRequest {
  template: PdfTemplate;
  data?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  options?: RenderOptions;
}

/** The PDF render result, with a ready-to-use `Blob` for the browser. */
export interface PdfStudioResult {
  bytes: Uint8Array;
  blob: Blob;
  pageCount: number;
  diagnostics: ExpressionDiagnostic[];
}

export interface SvgRenderResult {
  pages: string[];
  pageCount: number;
  diagnostics: ExpressionDiagnostic[];
}

/**
 * The render service — the no-UI happy path (§12): pass a template + data, get a
 * `Blob`/`Uint8Array`. A thin Angular wrapper over the framework-agnostic engine
 * (`@ngx-pdf-studio/core`); all the work happens there. Angular-12-safe:
 * `providedIn: 'root'`, constructor DI, no Signals/`inject()`.
 */
@Injectable({ providedIn: 'root' })
export class PdfStudioRenderer {
  /** Render a template + data to a real PDF. */
  async render(request: PdfRenderRequest): Promise<PdfStudioResult> {
    const result = await renderToPdf(request.template, this.toInput(request), request.options);
    const blob = new Blob([result.bytes], { type: 'application/pdf' });
    return {
      bytes: result.bytes,
      blob,
      pageCount: result.pageCount,
      diagnostics: result.diagnostics,
    };
  }

  /** Render a template + data to SVG (one string per page) for preview. */
  renderSvg(request: PdfRenderRequest): SvgRenderResult {
    return renderToSvg(request.template, this.toInput(request), request.options);
  }

  /** Create an object URL for a result's blob (caller revokes when done). */
  toObjectUrl(result: PdfStudioResult): string {
    return URL.createObjectURL(result.blob);
  }

  /** Trigger a browser download of the rendered PDF. */
  download(result: PdfStudioResult, filename = 'document.pdf'): void {
    const url = this.toObjectUrl(result);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** Open the rendered PDF in a new tab. */
  open(result: PdfStudioResult): void {
    window.open(this.toObjectUrl(result), '_blank', 'noopener');
  }

  private toInput(request: PdfRenderRequest): {
    data?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  } {
    return {
      ...(request.data ? { data: request.data } : {}),
      ...(request.parameters ? { parameters: request.parameters } : {}),
    };
  }
}
