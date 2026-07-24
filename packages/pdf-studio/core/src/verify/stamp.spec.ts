import type { PdfTemplate } from '../model/template';
import { renderToSvg } from '../render';
import { hashDocument } from './verify';
import { stampVerification } from './stamp';

function baseTemplate(): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'inv' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      direction: 'rtl',
      locale: { language: 'fa', digits: 'latn', calendar: 'gregorian' },
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands: [
      {
        id: 'detail',
        type: 'detail',
        height: { mode: 'fixed', value: 40 },
        elements: [
          {
            id: 't1',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 200, height: 16 },
            zIndex: 1,
            text: 'فاکتور',
          },
        ],
      },
    ],
    resources: { fonts: [], images: [] },
  } as unknown as PdfTemplate;
}

describe('stampVerification', () => {
  it('appends a pageFooter band carrying a QR + short code', () => {
    const tpl = baseTemplate();
    const before = tpl.bands.length;
    const stamped = stampVerification(tpl, { data: { total: 100 } });

    expect(stamped.bands).toHaveLength(before + 1);
    const band = stamped.bands[stamped.bands.length - 1]!;
    expect(band.type).toBe('pageFooter');
    const types = band.elements.map((e) => e.type).sort();
    expect(types).toEqual(['qrcode', 'staticText']);
  });

  it('does not mutate the original template', () => {
    const tpl = baseTemplate();
    const before = tpl.bands.length;
    stampVerification(tpl, { data: { total: 100 } });
    expect(tpl.bands).toHaveLength(before);
  });

  it('encodes the hash of the ORIGINAL template (no self-reference)', () => {
    const tpl = baseTemplate();
    const input = { data: { total: 100 } };
    const { hash, short } = hashDocument(tpl, input);
    const stamped = stampVerification(tpl, input);

    const qr = stamped.bands.at(-1)!.elements.find((e) => e.type === 'qrcode')! as {
      value: { source: string };
    };
    const code = stamped.bands.at(-1)!.elements.find((e) => e.type === 'staticText')! as {
      text: string;
    };
    // QR literal expression should contain the full hash; label shows the short code
    expect(qr.value.source).toContain(hash);
    expect(code.text).toContain(short);
  });

  it('can encode a verify URL instead of the raw hash', () => {
    const tpl = baseTemplate();
    const stamped = stampVerification(tpl, { verifyUrl: 'https://verify.example/doc' });
    const qr = stamped.bands.at(-1)!.elements.find((e) => e.type === 'qrcode')! as {
      value: { source: string };
    };
    expect(qr.value.source).toContain('https://verify.example/doc?h=');
  });

  it('renders without error and the short code appears in the output', () => {
    const tpl = baseTemplate();
    const input = { data: { total: 100 } };
    const { short } = hashDocument(tpl, input);
    const stamped = stampVerification(tpl, input);
    const { pages } = renderToSvg(stamped, input);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.join('')).toContain(short);
  });
});
