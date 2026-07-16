import type { AnyElement, Paragraph } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function template(el: AnyElement): PdfTemplate {
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
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'auto', min: 10 }, elements: [el] }],
    resources: { fonts: [], images: [] },
  };
}

const richText = (paragraphs: Paragraph[], width = 300): AnyElement =>
  ({
    id: 'rt',
    type: 'richText',
    bounds: { x: 0, y: 0, width, height: 14 },
    zIndex: 1,
    paragraphs,
  }) as AnyElement;

const laid = (el: AnyElement, data: Record<string, unknown> = {}) =>
  layoutDocument(template(el), { data }).pages[0]!.elements.find((e) => e.id === 'rt')!;

describe('rich text layout (§5)', () => {
  it('keeps per-run styling and merges same-style words', () => {
    const el = laid(
      richText([
        {
          runs: [
            { text: 'Hello ', fontSize: 12 },
            { text: 'bold', fontSize: 12, bold: true },
            { text: ' world', fontSize: 12 },
          ],
        },
      ]),
    );
    const line = el.richText!.paragraphs[0]!.lines[0]!;
    expect(line.runs.map((r) => r.text).join('')).toContain('Hello');
    expect(line.runs.some((r) => r.bold && r.text.includes('bold'))).toBe(true);
  });

  it('resolves an inline expression run', () => {
    const el = laid(richText([{ runs: [{ text: 'Hi ' }, { expr: { source: 'name' } }] }]), {
      name: 'Sara',
    });
    const text = el
      .richText!.paragraphs[0]!.lines.flatMap((l) => l.runs.map((r) => r.text))
      .join('');
    expect(text).toContain('Sara');
  });

  it('wraps long text into multiple lines and grows the element height', () => {
    const long = 'word '.repeat(60).trim();
    const el = laid(richText([{ runs: [{ text: long, fontSize: 12 }] }], 80));
    expect(el.richText!.paragraphs[0]!.lines.length).toBeGreaterThan(1);
    expect(el.bounds.height).toBeGreaterThan(14);
  });

  it('lays out multiple paragraphs', () => {
    const el = laid(richText([{ runs: [{ text: 'First' }] }, { runs: [{ text: 'Second' }] }]));
    expect(el.richText!.paragraphs.length).toBe(2);
  });

  it('renders to SVG (styled tspans) and PDF', async () => {
    const tpl = template(
      richText([
        { runs: [{ text: 'Plain ' }, { text: 'Bold', bold: true, fontSize: 14 }], align: 'center' },
      ]),
    );
    const svg = renderToSvg(tpl).pages[0]!;
    expect(svg).toContain('<tspan');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('Bold');
    const pdf = await renderToPdf(tpl);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
  });
});
