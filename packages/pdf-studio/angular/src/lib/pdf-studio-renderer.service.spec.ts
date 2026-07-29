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

  // Object-URL lifetime (see `revokeLater`): revoking in the same tick as the
  // click cancels the download in Firefox/Safari, while never revoking pins the
  // whole PDF in memory for the life of the page. Both halves are asserted.
  //
  // jsdom implements neither `URL.createObjectURL` nor a real `window.open`, so
  // they are installed here rather than spied on. Deferral is asserted by
  // capturing the scheduled callback instead of running fake timers: zone.js
  // captures the real `setTimeout` when it patches the global, so Jest's fake
  // clock never drives timers scheduled from library code under this preset.
  describe('object URL lifetime', () => {
    let created: string[];
    let revoked: string[];
    let scheduled: Array<{ run: () => void; ms: number }>;
    let result: Awaited<ReturnType<PdfStudioRenderer['render']>>;

    beforeEach(async () => {
      result = await service.render({ template, data: { title: 'Hello' } });

      created = [];
      revoked = [];
      scheduled = [];
      let n = 0;
      (URL as unknown as Record<string, unknown>)['createObjectURL'] = (): string => {
        const url = `blob:mock/${++n}`;
        created.push(url);
        return url;
      };
      (URL as unknown as Record<string, unknown>)['revokeObjectURL'] = (url: string): void => {
        revoked.push(url);
      };
      jest.spyOn(window, 'setTimeout').mockImplementation(((run: () => void, ms: number) => {
        scheduled.push({ run, ms });
        return 0;
      }) as unknown as typeof window.setTimeout);
      jest.spyOn(window, 'open').mockReturnValue(null);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      delete (URL as unknown as Record<string, unknown>)['createObjectURL'];
      delete (URL as unknown as Record<string, unknown>)['revokeObjectURL'];
    });

    it('defers revoking the download URL past the click, then revokes it', () => {
      service.download(result, 'out.pdf');

      expect(created).toHaveLength(1);
      expect(revoked).toEqual([]); // same tick as click() — revoking here cancels it
      expect(scheduled).toHaveLength(1);

      scheduled[0]!.run();
      expect(revoked).toEqual(created);
    });

    it('defers revoking the URL opened in a new tab, then revokes it', () => {
      expect(service.open(result)).toBeNull();

      expect(created).toHaveLength(1);
      expect(revoked).toEqual([]); // the tab has not loaded the blob yet
      expect(scheduled).toHaveLength(1);

      scheduled[0]!.run();
      expect(revoked).toEqual(created);
    });

    it('gives a new tab longer to load than a download needs', () => {
      service.download(result, 'out.pdf');
      const downloadDelay = scheduled[0]!.ms;

      scheduled.length = 0;
      service.open(result);

      expect(downloadDelay).toBeGreaterThan(0);
      expect(scheduled[0]!.ms).toBeGreaterThan(downloadDelay);
    });
  });
});
