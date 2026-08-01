/**
 * Layout used to measure with the estimator while the painter drew with the
 * real face, so line breaks were computed from a shape the paper never had.
 * These pin the routing: real metrics where we hold the bytes, the estimator
 * where we do not, and no silent substitution in between (designer-ux 1.12).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { PdfTemplate } from '../model/template';
import { layoutDocument } from '../render';
import { SimpleTextMeasurer } from './measure';
import { clearMeasurerCache, createTemplateMeasurer, decodeFontBytes } from './template-measurer';

const FONT_PATH = join(__dirname, '../../../pdf/fonts/vazirmatn/Vazirmatn-Regular.ttf');
const FONT_BYTES = new Uint8Array(readFileSync(FONT_PATH));
const FONT_B64 = Buffer.from(FONT_BYTES).toString('base64');

/** Narrow enough that where the text breaks depends on the metrics used. */
function template(fontFamily: string, fonts: PdfTemplate['resources']['fonts'] = []): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'm' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      direction: 'rtl',
      locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
      unit: 'pt',
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands: [
      {
        id: 'b',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 300 },
        elements: [
          {
            id: 't',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 140, height: 20 },
            zIndex: 1,
            text: 'این یک متن فارسی برای سنجش محل شکست خط است',
            typography: { fontFamily, fontSize: 12 },
          },
        ],
      },
    ],
    resources: { fonts, images: [] },
  };
}

const laid = (t: PdfTemplate, options = {}) =>
  layoutDocument(t, { data: {} }, options).pages[0]!.elements[0]!;

beforeEach(() => clearMeasurerCache());

describe('layout measures with the fonts the document is drawn with', () => {
  it('breaks lines differently once the real metrics are available', () => {
    const estimated = laid(template('Vazirmatn'));
    const real = laid(template('Vazirmatn', [{ id: 'f', family: 'Vazirmatn', data: FONT_B64 }]));
    // the estimator's half-em guess fits the text in fewer lines than it needs
    expect(real.lines!.length).toBeGreaterThan(estimated.lines!.length);
    expect(real.bounds.height).toBeGreaterThan(estimated.bounds.height);
  });

  it('measures the same whether the font arrives in the template or from the caller', () => {
    const fromTemplate = laid(
      template('Vazirmatn', [{ id: 'f', family: 'Vazirmatn', data: FONT_B64 }]),
    );
    const fromCaller = laid(template('Vazirmatn'), {
      pdf: { fonts: [{ family: 'Vazirmatn', bytes: FONT_BYTES }] },
    });
    expect(fromCaller.lines).toEqual(fromTemplate.lines);
    expect(fromCaller.bounds.height).toEqual(fromTemplate.bounds.height);
  });

  it('leaves a family it has no bytes for on the estimator', () => {
    // Fontkit's own measurer falls back to its *first* font for an unknown
    // family, which would measure Helvetica with Persian metrics and call it
    // accurate. Routing must not do that.
    const withFont = laid(
      template('Helvetica', [{ id: 'f', family: 'Vazirmatn', data: FONT_B64 }]),
    );
    const withoutFont = laid(template('Helvetica'));
    expect(withFont.lines).toEqual(withoutFont.lines);
    expect(withFont.bounds.height).toEqual(withoutFont.bounds.height);
  });

  it('lets an explicitly supplied measurer win', () => {
    const forced = laid(template('Vazirmatn', [{ id: 'f', family: 'Vazirmatn', data: FONT_B64 }]), {
      paginate: { measurer: new SimpleTextMeasurer() },
    });
    expect(forced.lines).toEqual(laid(template('Vazirmatn')).lines);
  });

  it('keeps the estimator when the template declares no usable font', () => {
    // a URL-only font carries no bytes to measure with
    const urlOnly = laid(
      template('Vazirmatn', [{ id: 'f', family: 'Vazirmatn', url: 'https://x/f.ttf' }]),
    );
    expect(urlOnly.lines).toEqual(laid(template('Vazirmatn')).lines);
  });
});

describe('createTemplateMeasurer', () => {
  it('returns nothing for an empty list, so callers keep the estimator', () => {
    expect(createTemplateMeasurer([])).toBeUndefined();
  });

  it('returns nothing rather than throwing on bytes fontkit cannot parse', () => {
    expect(
      createTemplateMeasurer([{ family: 'Broken', bytes: new Uint8Array([1, 2, 3]) }]),
    ).toBeUndefined();
  });

  it('reuses the measurer when handed the very same faces', () => {
    const fonts = [{ family: 'Vazirmatn', bytes: FONT_BYTES }];
    expect(createTemplateMeasurer(fonts)).toBe(createTemplateMeasurer(fonts));
  });

  it('does not reuse it for different bytes', () => {
    const a = createTemplateMeasurer([{ family: 'Vazirmatn', bytes: FONT_BYTES }]);
    const b = createTemplateMeasurer([{ family: 'Vazirmatn', bytes: new Uint8Array(FONT_BYTES) }]);
    expect(a).not.toBe(b);
  });

  it('decodes base64 to the same bytes it was given', () => {
    expect(decodeFontBytes(FONT_B64)).toEqual(FONT_BYTES);
    expect(decodeFontBytes(FONT_BYTES)).toBe(FONT_BYTES);
  });
});
