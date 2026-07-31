/**
 * Properties the SVG painter drew and the PDF painter dropped, so the preview
 * disagreed with the print. Both were found the same way — measuring real output
 * rather than reading the model — and both survived because their only tests
 * asserted the SVG side. These pin the two painters together (§7, designer-ux
 * 1.1 and 1.2).
 */
import { inflateSync } from 'zlib';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf, renderToSvg } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function template(el: AnyElement): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'underline' },
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
      { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 120 }, elements: [el] },
    ],
    resources: { fonts: [], images: [] },
  };
}

const text = (decoration?: 'underline' | 'none'): AnyElement =>
  ({
    id: 't',
    type: 'staticText',
    bounds: { x: 0, y: 0, width: 200, height: 20 },
    zIndex: 1,
    text: 'Underlined',
    typography: {
      fontFamily: 'Helvetica',
      fontSize: 14,
      ...(decoration ? { decoration } : {}),
    },
  }) as AnyElement;

/** pdf-lib Flate-compresses content streams; inflate them all and concatenate. */
function pdfOps(bytes: Uint8Array): string {
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

describe('underline parity between the painters (designer-ux 1.1)', () => {
  it('draws a rule in the PDF, not only in the SVG', async () => {
    const on = await renderToPdf(template(text('underline')), { data: {} });
    const off = await renderToPdf(template(text()), { data: {} });
    const onOps = pdfOps(on.bytes);
    const offOps = pdfOps(off.bytes);

    // a stroked path appears only once the decoration is on
    const strokes = (s: string) => (s.match(/\bS\b/g) ?? []).length;
    expect(strokes(onOps)).toBeGreaterThan(strokes(offOps));
    expect(onOps).not.toEqual(offOps);
  });

  it('still renders it in the SVG', () => {
    const svg = renderToSvg(template(text('underline')), { data: {} }).pages[0] as string;
    expect(svg).toContain('text-decoration="underline"');
  });

  it('leaves undecorated text byte-identical in both painters', async () => {
    const a = await renderToPdf(template(text()), { data: {} });
    const b = await renderToPdf(template(text('none')), { data: {} });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(renderToSvg(template(text()), { data: {} }).pages[0]).toEqual(
      renderToSvg(template(text('none')), { data: {} }).pages[0],
    );
  });
});

describe('strike-through and vertical alignment (designer-ux 1.10)', () => {
  const boxed = (typography: Record<string, unknown>, height = 20): AnyElement =>
    ({
      id: 't',
      type: 'staticText',
      bounds: { x: 0, y: 0, width: 200, height },
      zIndex: 1,
      text: 'Struck',
      typography: { fontFamily: 'Helvetica', fontSize: 14, ...typography },
    }) as AnyElement;

  it('draws a strike rule in the PDF and marks it in the SVG', async () => {
    const plain = await renderToPdf(template(boxed({})), { data: {} });
    const struck = await renderToPdf(template(boxed({ decoration: 'line-through' })), { data: {} });
    const strokes = (s: string) => (s.match(/\bS\b/g) ?? []).length;
    expect(strokes(pdfOps(struck.bytes))).toBeGreaterThan(strokes(pdfOps(plain.bytes)));

    const svg = renderToSvg(template(boxed({ decoration: 'line-through' })), { data: {} })
      .pages[0] as string;
    expect(svg).toContain('text-decoration="line-through"');
  });

  it('moves the text down for middle and bottom, and only when there is room', () => {
    // A box shorter than its text is grown by layout to exactly the text height,
    // so there is no slack left and alignment has nothing to do. (A 20pt box
    // around a 16.8pt line *does* have slack, and does shift — that is the
    // point of the feature.)
    const tight = (va: string) =>
      renderToSvg(template(boxed({ verticalAlign: va }, 8)), { data: {} }).pages[0] as string;
    expect(tight('bottom')).toEqual(tight('top'));

    // a 100pt box has slack, so middle and bottom must differ from top
    const roomy = (va: string) =>
      renderToSvg(template(boxed({ verticalAlign: va }, 100)), { data: {} }).pages[0] as string;
    const yOf = (svg: string) => Number(/<tspan[^>]*y="([\d.]+)"/.exec(svg)?.[1]);
    expect(yOf(roomy('middle'))).toBeGreaterThan(yOf(roomy('top')));
    expect(yOf(roomy('bottom'))).toBeGreaterThan(yOf(roomy('middle')));
  });

  it('shifts by the same amount in both painters', async () => {
    // the PDF is bottom-up, so a downward shift must *lower* the baseline
    const topPdf = pdfOps((await renderToPdf(template(boxed({}, 100)), { data: {} })).bytes);
    const bottomPdf = pdfOps(
      (await renderToPdf(template(boxed({ verticalAlign: 'bottom' }, 100)), { data: {} })).bytes,
    );
    const tdY = (ops: string) => Number(/1 0 0 1 [\d.]+ ([\d.]+) Tm/.exec(ops)?.[1] ?? NaN);
    const top = tdY(topPdf);
    const bottom = tdY(bottomPdf);
    expect(Number.isFinite(top) && Number.isFinite(bottom)).toBe(true);
    // 100pt box, one 16.8pt line → 83.2pt of slack
    expect(top - bottom).toBeCloseTo(100 - 14 * 1.2, 1);
  });

  it('leaves default text byte-identical', async () => {
    const a = await renderToPdf(template(boxed({})), { data: {} });
    const b = await renderToPdf(template(boxed({ verticalAlign: 'top', decoration: 'none' })), {
      data: {},
    });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

describe('corner-radius parity between the painters (designer-ux 1.2)', () => {
  const black = { space: 'rgb', r: 0, g: 0, b: 0 } as const;
  const boxed = (radius?: number): AnyElement =>
    ({
      id: 'r',
      type: 'rectangle',
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      zIndex: 1,
      box: {
        fill: { color: { space: 'rgb', r: 0.9, g: 0.9, b: 0.9 } },
        border: { all: { width: 1, color: black }, ...(radius ? { radius } : {}) },
      },
    }) as AnyElement;

  it('rounds the corners in the PDF, not only in the SVG', async () => {
    const square = await renderToPdf(template(boxed()), { data: {} });
    const round = await renderToPdf(template(boxed(10)), { data: {} });
    expect(Buffer.from(square.bytes).equals(Buffer.from(round.bytes))).toBe(false);
    // a square box is one `re`; a rounded one is a path of curves
    expect(pdfOps(round.bytes)).toContain(' c\n');
  });

  it('still rounds them in the SVG', () => {
    const svg = renderToSvg(template(boxed(10)), { data: {} }).pages[0] as string;
    expect(svg).toMatch(/rx="10"|rx='10'/);
  });

  it('leaves a square box byte-identical to before', async () => {
    // radius 0 must take the plain drawRectangle path, not the curve path
    const a = await renderToPdf(template(boxed()), { data: {} });
    const b = await renderToPdf(template(boxed(0)), { data: {} });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it('clamps a radius larger than half the box instead of crossing the arcs', async () => {
    // 120×60 box: anything over 30 must behave as 30
    const huge = await renderToPdf(template(boxed(999)), { data: {} });
    const half = await renderToPdf(template(boxed(30)), { data: {} });
    expect(Buffer.from(huge.bytes).equals(Buffer.from(half.bytes))).toBe(true);
  });
});
