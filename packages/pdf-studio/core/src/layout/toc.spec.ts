import { createRenderContext } from '../binding/render-context';
import type { AnyElement } from '../model/elements';
import type { Band } from '../model/band';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf } from '../render';
import { paginate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const heading = (id: string, title: string, level: number): AnyElement =>
  ({
    id,
    type: 'staticText',
    bounds: { x: 0, y: 0, width: 300, height: 20 },
    zIndex: 1,
    text: title,
    bookmark: { level },
  }) as AnyElement;

const toc: AnyElement = {
  id: 'toc',
  type: 'toc',
  bounds: { x: 0, y: 40, width: 400, height: 120 },
  zIndex: 1,
  lineHeight: 16,
} as AnyElement;

// Tall chapter bands so each heading lands on its own page after the ToC page.
const chapter = (id: string, title: string, level = 0): Band => ({
  id,
  type: 'detail',
  height: { mode: 'fixed', value: 760 },
  pageBreakAfter: true,
  elements: [heading(`${id}-h`, title, level)],
});

function template(): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
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
    bands: [
      {
        id: 'cover',
        type: 'detail',
        height: { mode: 'fixed', value: 760 },
        pageBreakAfter: true,
        elements: [
          {
            id: 'cover-title',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 300, height: 24 },
            zIndex: 1,
            text: 'Contents',
          } as AnyElement,
          toc,
        ],
      },
      chapter('c1', 'Chapter One'),
      chapter('c2', 'Chapter Two'),
      chapter('s1', 'Section 2.1', 1),
    ],
    resources: { fonts: [], images: [] },
  };
}

describe('automatic table of contents (§11A-D)', () => {
  const doc = paginate(template(), createRenderContext({ data: {} }));
  const tocEl = doc.pages[0]!.elements.find((e) => e.id === 'toc')!;

  it('lists every bookmark with its page number', () => {
    expect(tocEl.lines).toHaveLength(3);
    expect(tocEl.lines![0]).toMatch(/Chapter One.*2$/);
    expect(tocEl.lines![1]).toMatch(/Chapter Two.*3$/);
  });

  it('indents nested levels', () => {
    expect(tocEl.lines![2]).toMatch(/^\s{4}Section 2\.1.*4$/);
  });

  it('keeps pagination stable across the two passes', () => {
    expect(doc.pageCount).toBe(4);
    // headings still start on pages 2..4 (the ToC did not shift anything)
    const pageOf = (text: string) =>
      doc.pages.findIndex((p) => p.elements.some((e) => e.text === text));
    expect(pageOf('Chapter One')).toBe(1);
    expect(pageOf('Section 2.1')).toBe(3);
  });

  it('respects maxDepth', () => {
    const t = template();
    const band = t.bands[0]!;
    band.elements = band.elements.map((e) =>
      e.id === 'toc' ? ({ ...e, maxDepth: 0 } as AnyElement) : e,
    );
    const shallow = paginate(t, createRenderContext({ data: {} }));
    const el = shallow.pages[0]!.elements.find((e) => e.id === 'toc')!;
    expect(el.lines).toHaveLength(2); // level-1 entry dropped
  });

  it('renders to PDF without diagnostics', async () => {
    const result = await renderToPdf(template());
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe('%PDF-');
    expect(result.diagnostics).toHaveLength(0);
  });
});
