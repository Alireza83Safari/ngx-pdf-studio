import { Injectable } from '@angular/core';
import { renderToPdf, renderToSvg } from '@ngx-pdf-studio/core';
import type { ExpressionDiagnostic, PdfTemplate, RenderOptions } from '@ngx-pdf-studio/core';

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

/** A download starts within a tick; a second is ample slack for every engine. */
const DOWNLOAD_REVOKE_MS = 1000;
/** A new tab has to boot a PDF viewer before it fetches the blob. */
const OPEN_REVOKE_MS = 60_000;

/**
 * Release an object URL after `delay`. Freeing it is what keeps a rendered
 * document from being pinned in memory for the lifetime of the page; the delay
 * is what keeps the consumer of the URL from losing it mid-flight.
 */
function revokeLater(url: string, delay: number): void {
  setTimeout(() => URL.revokeObjectURL(url), delay);
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

  /**
   * Trigger a browser download of the rendered PDF.
   *
   * The object URL is revoked on a later task, never synchronously after
   * `click()`: Firefox and Safari resolve the anchor's target asynchronously,
   * so revoking in the same tick cancels the download outright.
   */
  download(result: PdfStudioResult, filename = 'document.pdf'): void {
    const url = this.toObjectUrl(result);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
    revokeLater(url, DOWNLOAD_REVOKE_MS);
  }

  /**
   * Open the rendered PDF in a new tab. Returns the opened window (or `null`
   * when a popup blocker refused it) so callers can react.
   *
   * The URL is revoked once the new tab has had time to load the document —
   * leaving it alive forever pins the whole PDF in memory for the lifetime of
   * the page, and revoking it immediately gives the tab nothing to load.
   */
  open(result: PdfStudioResult): Window | null {
    const url = this.toObjectUrl(result);
    const opened = window.open(url, '_blank', 'noopener');
    revokeLater(url, OPEN_REVOKE_MS);
    return opened;
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
