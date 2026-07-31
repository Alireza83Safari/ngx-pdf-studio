/**
 * `resources.fonts` exists so a template is self-contained (§4), but nothing
 * read it: a font declared there was ignored and text fell back to a
 * Standard-14 face that cannot encode Persian at all. Only fonts passed to
 * `options.pdf.fonts` reached the document (designer-ux 1.4).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { LocaleSetup } from './model/locale';
import type { FontResource } from './model/resource';
import type { PdfTemplate } from './model/template';
import { renderToPdf } from './render';

const FA: LocaleSetup = { language: 'fa', digits: 'persian', calendar: 'jalali' };
const FONT_PATH = join(__dirname, '../../pdf/fonts/vazirmatn/Vazirmatn-Regular.ttf');
const FONT_BYTES = readFileSync(FONT_PATH);
const FONT_B64 = FONT_BYTES.toString('base64');

function template(fonts: FontResource[]): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'fonts' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      direction: 'rtl',
      locale: FA,
      unit: 'pt',
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands: [
      {
        id: 'b',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 60 },
        elements: [
          {
            id: 't',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 300, height: 24 },
            zIndex: 1,
            text: 'سلام دنیا',
            typography: { fontFamily: 'MyBrand', fontSize: 16 },
          },
        ],
      },
    ],
    resources: { fonts, images: [] },
  };
}

const encodingFailure = (d: { message: string }[]): boolean =>
  d.some((x) => /with the selected font/.test(x.message));

/**
 * Every case here embeds and subsets a full Vazirmatn two or three times over,
 * which is CPU-heavy enough to overrun Jest's 5s default once the rest of the
 * suite is contending for cores — the same reason the byte-determinism and
 * golden-i18n specs carry their own. These measure correctness, not speed.
 */
const SUBSET_TIMEOUT = 180000;

describe('template-declared fonts reach the PDF', () => {
  it(
    'embeds a font carried in resources.fonts, with no options at all',
    async () => {
      const bare = await renderToPdf(template([]), { data: {} });
      const carried = await renderToPdf(
        template([{ id: 'f1', family: 'MyBrand', data: FONT_B64 }]),
        {
          data: {},
        },
      );
      // without it, Persian cannot be encoded by the Standard-14 fallback
      expect(encodingFailure(bare.diagnostics)).toBe(true);
      expect(encodingFailure(carried.diagnostics)).toBe(false);
      expect(carried.bytes.length).toBeGreaterThan(bare.bytes.length);
    },
    SUBSET_TIMEOUT,
  );

  it(
    'embeds the bytes only once when the caller supplies the same family',
    async () => {
      const carried = await renderToPdf(
        template([{ id: 'f1', family: 'MyBrand', data: FONT_B64 }]),
        {
          data: {},
        },
      );
      const both = await renderToPdf(
        template([{ id: 'f1', family: 'MyBrand', data: FONT_B64 }]),
        {
          data: {},
        },
        { pdf: { fonts: [{ family: 'MyBrand', bytes: new Uint8Array(FONT_BYTES) }] } },
      );
      // One variant key, one embedded subset — not two copies of the same face.
      // Asserted as "no bigger", not "byte-identical": the invariant is that a
      // second copy of the face is not embedded, and a second copy costs
      // kilobytes. Exact equality would additionally pin object numbering and
      // xref widths, which this test has no business caring about.
      expect(both.bytes.length).toBeLessThanOrEqual(carried.bytes.length);
      // guard the guard: a genuine second face must be detectable this way
      const twoFaces = await renderToPdf(
        template([{ id: 'f1', family: 'MyBrand', data: FONT_B64 }]),
        { data: {} },
        { pdf: { fonts: [{ family: 'OtherBrand', bytes: new Uint8Array(FONT_BYTES) }] } },
      );
      expect(twoFaces.bytes.length).toBeGreaterThan(carried.bytes.length);
    },
    SUBSET_TIMEOUT,
  );

  it(
    'warns about a URL-only font instead of silently losing the text',
    async () => {
      const res = await renderToPdf(
        template([{ id: 'f1', family: 'MyBrand', url: 'https://example.com/f.ttf' }]),
        { data: {} },
      );
      expect(res.diagnostics.some((d) => /declared by URL/.test(d.message))).toBe(true);
    },
    SUBSET_TIMEOUT,
  );

  it(
    'lets a caller override what the template carries',
    async () => {
      // both name the same family; the caller's copy must win the variant key
      const res = await renderToPdf(
        template([{ id: 'f1', family: 'MyBrand', data: FONT_B64 }]),
        { data: {} },
        { pdf: { fonts: [{ family: 'MyBrand', bytes: new Uint8Array(FONT_BYTES) }] } },
      );
      expect(encodingFailure(res.diagnostics)).toBe(false);
    },
    SUBSET_TIMEOUT,
  );
});
