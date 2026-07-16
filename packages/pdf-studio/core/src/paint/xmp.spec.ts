import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const template: PdfTemplate = {
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
  bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 30 }, elements: [] }],
  resources: { fonts: [], images: [] },
};

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

describe('XMP metadata (§11A-A)', () => {
  it('embeds an uncompressed XMP /Metadata packet with the title and fixed dates', async () => {
    const result = await renderToPdf(
      template,
      {},
      { pdf: { metadata: { title: 'Quarterly Report', author: 'Acme' } } },
    );
    const content = text(result.bytes);
    expect(content).toContain('/Type /Metadata');
    expect(content).toContain('/Subtype /XML');
    expect(content).toContain('<x:xmpmeta');
    expect(content).toContain('Quarterly Report'); // dc:title
    expect(content).toContain('Acme'); // dc:creator
    expect(content).toContain('<xmp:CreateDate>1970-01-01T00:00:00Z</xmp:CreateDate>');
  });

  it('escapes XML special characters in metadata', async () => {
    const result = await renderToPdf(template, {}, { pdf: { metadata: { title: 'A & B <C>' } } });
    const content = text(result.bytes);
    expect(content).toContain('A &#38; B &#60;C&#62;');
    expect(content).not.toContain('A & B <C>');
  });

  it('is byte-deterministic across renders', async () => {
    const a = await renderToPdf(template, {}, { pdf: { metadata: { title: 'X' } } });
    const b = await renderToPdf(template, {}, { pdf: { metadata: { title: 'X' } } });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});
