import { inflateSync } from 'zlib';
import type { CmykColor, RgbColor } from '../model/color';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function templateWithFill(fill: CmykColor | RgbColor): PdfTemplate {
  const rect: AnyElement = {
    id: 'r',
    type: 'rectangle',
    bounds: { x: 0, y: 0, width: 100, height: 50 },
    zIndex: 1,
    box: { fill: { color: fill } },
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

// pdf-lib Flate-compresses content streams, so inflate every stream and
// concatenate the decoded text before matching content operators.
function asText(bytes: Uint8Array): string {
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
// 4 numbers followed by the CMYK non-stroking operator `k`.
const CMYK_FILL = /[\d.]+ [\d.]+ [\d.]+ [\d.]+ k\b/;
// 3 numbers followed by the RGB non-stroking operator `rg`.
const RGB_FILL = /[\d.]+ [\d.]+ [\d.]+ rg\b/;

describe('CMYK color in the PDF painter (§11A-B)', () => {
  it('emits a DeviceCMYK fill operator for CMYK colors', async () => {
    const result = await renderToPdf(templateWithFill({ space: 'cmyk', c: 0, m: 0.5, y: 1, k: 0 }));
    const content = asText(result.bytes);
    expect(CMYK_FILL.test(content)).toBe(true);
  });

  it('still emits DeviceRGB for RGB colors', async () => {
    const result = await renderToPdf(templateWithFill({ space: 'rgb', r: 10, g: 20, b: 30 }));
    const content = asText(result.bytes);
    expect(RGB_FILL.test(content)).toBe(true);
  });
});
