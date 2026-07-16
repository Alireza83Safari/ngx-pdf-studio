import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { ExpressionDiagnostic, PdfTemplate } from '@ngx-pdf-studio/core';
import { PdfStudioRenderer } from './pdf-studio-renderer.service';

/**
 * Read-only preview component (§12). Renders a template + data to SVG via the
 * shared layout tree and displays one SVG per page — the same painter the
 * designer canvas uses, so preview matches the PDF (§7). Angular-12-safe:
 * NgModule-declared, `OnPush`, `*ngIf`/`*ngFor` with `trackBy`, constructor DI.
 */
@Component({
  selector: 'pdf-studio-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pdf-studio-preview" *ngIf="template; else empty">
      <div
        class="pdf-studio-preview__page"
        *ngFor="let page of pages; trackBy: trackByIndex"
        [innerHTML]="page"
      ></div>
    </div>
    <ng-template #empty>
      <div class="pdf-studio-preview__empty">No template to preview.</div>
    </ng-template>
  `,
})
export class PdfStudioPreviewComponent implements OnChanges {
  @Input() template?: PdfTemplate;
  @Input() data?: Record<string, unknown>;

  pages: SafeHtml[] = [];
  diagnostics: ExpressionDiagnostic[] = [];

  constructor(
    private readonly sanitizer: DomSanitizer,
    private readonly renderer: PdfStudioRenderer,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnChanges(): void {
    this.update();
  }

  trackByIndex(index: number): number {
    return index;
  }

  private update(): void {
    if (!this.template) {
      this.pages = [];
      this.diagnostics = [];
      return;
    }
    const result = this.renderer.renderSvg({
      template: this.template,
      ...(this.data ? { data: this.data } : {}),
    });
    this.pages = result.pages.map((svg) => this.sanitizer.bypassSecurityTrustHtml(svg));
    this.diagnostics = result.diagnostics;
    this.changeDetector.markForCheck();
  }
}
