import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { PdfTemplate } from '@ngx-pdf-studio/core';
import { PdfStudioPreviewComponent } from './pdf-studio-preview.component';
import { PdfStudioRendererModule } from './pdf-studio-renderer.module';

const template: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'preview-test' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    direction: 'ltr',
    locale: { language: 'en', digits: 'latn', calendar: 'gregorian' },
    unit: 'pt',
  },
  styles: [],
  datasets: [],
  parameters: [],
  bands: [
    {
      id: 'b',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 40 },
      elements: [
        {
          id: 't',
          type: 'staticText',
          bounds: { x: 0, y: 0, width: 200, height: 20 },
          zIndex: 1,
          text: 'Preview!',
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

describe('PdfStudioPreviewComponent (§7, §12)', () => {
  let fixture: ComponentFixture<PdfStudioPreviewComponent>;
  let component: PdfStudioPreviewComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PdfStudioRendererModule],
    }).compileComponents();
    fixture = TestBed.createComponent(PdfStudioPreviewComponent);
    component = fixture.componentInstance;
  });

  it('shows an empty state when no template is set', () => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No template');
  });

  it('renders one SVG page containing the resolved text', () => {
    component.template = template;
    component.ngOnChanges();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const page = host.querySelector('.pdf-studio-preview__page');
    expect(page).toBeTruthy();
    expect(page?.querySelector('svg')).toBeTruthy();
    expect(host.textContent).toContain('Preview!');
    expect(component.pages.length).toBe(1);
  });

  // The component exists to guarantee preview == PDF (§7). A template reading
  // `$parameters` broke that promise, because the input was never forwarded.
  it('forwards report parameters to the expression scope', () => {
    component.template = {
      ...template,
      bands: [
        {
          ...template.bands[0]!,
          elements: [
            {
              id: 'p',
              type: 'dataField',
              bounds: { x: 0, y: 0, width: 200, height: 20 },
              zIndex: 1,
              value: { source: '$parameters.company' },
            },
          ],
        },
      ],
    };
    component.parameters = { company: 'Acme Ltd' };
    component.ngOnChanges();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Acme Ltd');
  });
});
