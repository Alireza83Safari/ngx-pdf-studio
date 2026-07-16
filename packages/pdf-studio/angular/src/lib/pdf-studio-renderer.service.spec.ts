import { TestBed } from '@angular/core/testing';
import type { PdfTemplate } from '@ngx-pdf-studio/core';
import { PdfStudioRenderer } from './pdf-studio-renderer.service';

const template: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'svc-test' },
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
          type: 'dataField',
          bounds: { x: 0, y: 0, width: 200, height: 20 },
          zIndex: 1,
          value: { source: 'title' },
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

describe('PdfStudioRenderer (§12)', () => {
  let service: PdfStudioRenderer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfStudioRenderer);
  });

  it('is provided in root', () => {
    expect(service).toBeInstanceOf(PdfStudioRenderer);
  });

  it('renders a template + data to a PDF blob', async () => {
    const result = await service.render({ template, data: { title: 'Hello' } });
    expect(result.pageCount).toBe(1);
    expect(result.blob.type).toBe('application/pdf');
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('renders SVG pages for preview', () => {
    const result = service.renderSvg({ template, data: { title: 'Hello' } });
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]).toContain('<svg');
    expect(result.pages[0]).toContain('Hello');
  });
});
