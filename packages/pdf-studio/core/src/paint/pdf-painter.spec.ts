import { existsSync, readFileSync } from 'node:fs';
import { createRenderContext } from '../binding/render-context';
import { paginate } from '../layout/paginate';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { paintToPdf } from './pdf-painter';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

function template(elements: AnyElement[]): PdfTemplate {
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
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 60 }, elements }],
    resources: { fonts: [], images: [] },
  };
}

const render = (tpl: PdfTemplate): ReturnType<typeof paginate> =>
  paginate(tpl, createRenderContext({ data: {} }));

const SHAPES: AnyElement[] = [
  {
    id: 'r',
    type: 'rectangle',
    bounds: { x: 0, y: 0, width: 50, height: 20 },
    zIndex: 1,
    box: { fill: { color: { space: 'cmyk', c: 0.5, m: 0, y: 0, k: 0 } } },
  },
  {
    id: 'l',
    type: 'line',
    bounds: { x: 0, y: 30, width: 80, height: 0 },
    zIndex: 1,
    stroke: { width: 2, color: { space: 'rgb', r: 0, g: 0, b: 0 } },
  },
  {
    id: 'e',
    type: 'ellipse',
    bounds: { x: 0, y: 40, width: 30, height: 30 },
    zIndex: 1,
    box: {
      fill: {
        color: {
          space: 'spot',
          name: 'Pantone X',
          approximation: { space: 'rgb', r: 200, g: 0, b: 0 },
        },
      },
    },
  },
];

describe('paintToPdf', () => {
  it('renders shapes (rgb/cmyk/spot) without throwing', async () => {
    const bytes = await paintToPdf(render(template(SHAPES)));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('is byte-deterministic across renders (fixed dates, no timestamps; §3)', async () => {
    const a = await paintToPdf(render(template(SHAPES)));
    const b = await paintToPdf(render(template(SHAPES)));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  const maybe = existsSync(DEJAVU) ? it : it.skip;
  maybe(
    'embeds and subsets a custom font, growing the file vs. the standard-font path',
    async () => {
      const bytes = new Uint8Array(readFileSync(DEJAVU));
      const text: AnyElement = {
        id: 't',
        type: 'staticText',
        bounds: { x: 0, y: 0, width: 200, height: 20 },
        zIndex: 1,
        text: 'Hello, embedded font!',
        typography: { fontFamily: 'DejaVu Sans', fontSize: 14 },
      };
      const withFont = await paintToPdf(render(template([text])), {
        fonts: [{ family: 'DejaVu Sans', bytes }],
      });
      const withoutFont = await paintToPdf(
        render(template([{ ...text, typography: { fontSize: 14 } }])),
      );
      expect(withFont.length).toBeGreaterThan(withoutFont.length);
      expect(new TextDecoder().decode(withFont.slice(0, 5))).toBe('%PDF-');
    },
    30000,
  );
});
