import { inflateSync } from 'zlib';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function template(rotation: number): PdfTemplate {
  const rect: AnyElement = {
    id: 'r',
    type: 'rectangle',
    bounds: { x: 40, y: 10, width: 100, height: 40 },
    zIndex: 1,
    rotation,
    box: { fill: { color: { space: 'rgb', r: 200, g: 0, b: 0 } } },
  } as AnyElement;
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
      { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 60 }, elements: [rect] },
    ],
    resources: { fonts: [], images: [] },
  };
}

function inflatedText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  let out = '';
  let i = 0;
  for (;;) {
    const s = raw.indexOf('stream', i);
    if (s < 0) break;
    let ds = s + 6;
    if (raw[ds] === 0x0d) ds++;
    if (raw[ds] === 0x0a) ds++;
    const e = raw.indexOf('endstream', ds);
    if (e < 0) break;
    const chunk = raw.subarray(ds, e);
    try {
      out += inflateSync(chunk).toString('latin1');
    } catch {
      out += chunk.toString('latin1');
    }
    i = e + 9;
  }
  return out;
}

describe('element rotation (§5)', () => {
  it('wraps the rotated element in an SVG rotate() transform about its center', () => {
    const svg = renderToSvg(template(45)).pages[0]!;
    // element at page-margin offset: x=20+40=60, y=20+10=30 → center (110, 50).
    expect(svg).toContain('<g transform="rotate(45 110 50)">');
  });

  it('emits no transform group when rotation is 0', () => {
    const svg = renderToSvg(template(0)).pages[0]!;
    expect(svg).not.toContain('rotate(');
  });

  it('rotates via a graphics-state matrix in the PDF (q…cm…Q around the fill)', async () => {
    const result = await renderToPdf(template(90));
    const content = inflatedText(result.bytes);
    // cos(±90°)=0, sin=∓1 → a 0 ±1 ∓1 0 0 0 cm rotation matrix inside q…Q.
    expect(content).toMatch(/q[\s\S]*0 -1 1 0 0 0 cm[\s\S]*Q/);
  });

  it('emits no rotation matrix for unrotated elements', async () => {
    const rotated = inflatedText((await renderToPdf(template(90))).bytes);
    const plain = inflatedText((await renderToPdf(template(0))).bytes);
    expect(rotated).toContain('0 -1 1 0 0 0 cm');
    expect(plain).not.toContain('0 -1 1 0 0 0 cm');
  });
});
