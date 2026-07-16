import type { AnyElement } from './model/elements';
import type { Band } from './model/band';
import type { LocaleSetup } from './model/locale';
import type { PdfTemplate } from './model/template';
import { renderToPdf, renderToSvg, layoutDocument } from './render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function template(elements: AnyElement[], bandType: Band['type'] = 'reportHeader'): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'render-test' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      direction: 'ltr',
      locale: EN,
      unit: 'pt',
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands: [{ id: 'b', type: bandType, height: { mode: 'fixed', value: 100 }, elements }],
    resources: { fonts: [], images: [] },
  };
}

const TITLE: AnyElement = {
  id: 'title',
  type: 'staticText',
  bounds: { x: 0, y: 0, width: 200, height: 24 },
  zIndex: 2,
  text: 'Invoice',
  typography: { fontSize: 18, fontWeight: 'bold', color: { space: 'rgb', r: 10, g: 20, b: 30 } },
};

const BOX: AnyElement = {
  id: 'box',
  type: 'rectangle',
  bounds: { x: 0, y: 30, width: 100, height: 40 },
  zIndex: 1,
  box: {
    fill: { color: { space: 'rgb', r: 240, g: 240, b: 240 } },
    border: { all: { width: 1, color: { space: 'rgb', r: 0, g: 0, b: 0 } } },
  },
};

describe('renderToSvg (§7 preview painter)', () => {
  it('produces one SVG per page containing resolved text and shapes', () => {
    const result = renderToSvg(template([TITLE, BOX]));
    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    const svg = result.pages[0]!;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Invoice');
    expect(svg).toContain('<rect');
    expect(svg).toContain('font-weight="bold"');
  });

  it('escapes XML-significant characters in text', () => {
    const svg = renderToSvg(template([{ ...TITLE, text: 'A & B <c> "d"' }])).pages[0]!;
    expect(svg).toContain('A &amp; B &lt;c&gt;');
    expect(svg).not.toContain('<c>');
  });

  it('is deterministic (snapshot)', () => {
    expect(renderToSvg(template([TITLE, BOX])).pages).toMatchSnapshot();
  });
});

describe('renderToPdf (§10 PDF painter)', () => {
  it('produces a real, single-page PDF', async () => {
    const result = await renderToPdf(template([TITLE, BOX]));
    expect(result.pageCount).toBe(1);
    expect(header(result.bytes)).toBe('%PDF-');
    expect(result.bytes.length).toBeGreaterThan(500);
  });

  it('emits one PDF page per layout page', async () => {
    const detail = template(
      [
        {
          id: 'n',
          type: 'dataField',
          bounds: { x: 0, y: 0, width: 100, height: 300 },
          zIndex: 1,
          value: { source: 'name' },
        },
      ],
      'detail',
    );
    detail.datasets = [{ name: 'items', source: { kind: 'path', path: 'items' } }];
    detail.bands[0]!.dataset = 'items';
    detail.bands[0]!.height = { mode: 'fixed', value: 300 };
    const data = { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };
    const result = await renderToPdf(detail, { data });
    expect(result.pageCount).toBeGreaterThan(1);
  });

  it('is byte-deterministic for identical inputs (§3)', async () => {
    const a = await renderToPdf(template([TITLE, BOX]));
    const b = await renderToPdf(template([TITLE, BOX]));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it('records a non-fatal diagnostic when the fallback font cannot encode text', async () => {
    const result = await renderToPdf(template([{ ...TITLE, text: 'سلام دنیا' }]));
    expect(header(result.bytes)).toBe('%PDF-'); // still produced a PDF
    expect(result.diagnostics.some((d) => /Could not render text/.test(d.message))).toBe(true);
  });
});

function header(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, 5));
}

describe('layoutDocument', () => {
  it('returns the shared layout tree both painters consume', () => {
    const doc = layoutDocument(template([TITLE]));
    expect(doc.pages[0]!.elements.some((e) => e.id === 'title')).toBe(true);
  });
});
