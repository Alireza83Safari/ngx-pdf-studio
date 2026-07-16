import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { PdfStudioPreviewComponent } from './pdf-studio-preview.component';

/**
 * NgModule entry for the lightweight render/preview path (§2.1, §12). Shipping
 * an NgModule (not standalone-only) keeps the library importable on Angular
 * 12–14. The render service is `providedIn: 'root'`, so it is available without
 * importing this module.
 */
@NgModule({
  imports: [CommonModule],
  declarations: [PdfStudioPreviewComponent],
  exports: [PdfStudioPreviewComponent],
})
export class PdfStudioRendererModule {}
