/**
 * Properties the SVG painter drew and the PDF painter dropped, so the preview
 * disagreed with the print. Both were found the same way — measuring real output
 * rather than reading the model — and each survived because its only test
 * asserted the SVG side. These pin the two painters together (§7, designer-ux
 * 1.1, 1.2, 1.10 and 1.11).
 */
import { inflateSync } from 'zlib';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf, renderToSvg } from '../render';

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

describe('letter spacing (designer-ux 1.13)', () => {
  const spaced = (letterSpacing?: number, id = 't'): AnyElement =>
    ({
      id,
      type: 'staticText',
      bounds: { x: 0, y: 0, width: 300, height: 20 },
      zIndex: 1,
      text: 'SPACED',
      typography: {
        fontFamily: 'Helvetica',
        fontSize: 12,
        ...(letterSpacing ? { letterSpacing } : {}),
      },
    }) as AnyElement;

  it('emits Tc in the PDF and letter-spacing in the SVG', async () => {
    const ops = pdfOps((await renderToPdf(template(spaced(3)), { data: {} })).bytes);
    expect(ops).toMatch(/\b3 Tc\b/);
    const svg = renderToSvg(template(spaced(3)), { data: {} }).pages[0] as string;
    expect(svg).toContain('letter-spacing="3"');
  });

  it('clears Tc again so it cannot leak into the next element', async () => {
    const ops = pdfOps((await renderToPdf(template(spaced(3)), { data: {} })).bytes);
    // set once, cleared once — text state survives pdf-lib's own BT/ET blocks
    expect(ops.match(/\b3 Tc\b/g)).toHaveLength(1);
    expect(ops).toMatch(/\b0 Tc\b/);
    expect(ops.lastIndexOf('0 Tc')).toBeGreaterThan(ops.indexOf('3 Tc'));
  });

  it('leaves a following element unspaced', async () => {
    const doc = template(spaced(3));
    doc.bands[0]!.elements.push({
      ...(spaced(undefined, 'plain') as object),
      bounds: { x: 0, y: 40, width: 300, height: 20 },
    } as AnyElement);
    const ops = pdfOps((await renderToPdf(doc, { data: {} })).bytes);
    // the spacing is closed before the second element's text is drawn
    const close = ops.lastIndexOf('0 Tc');
    const lastText = ops.lastIndexOf('Tj');
    expect(close).toBeLessThan(lastText);
  });

  it('widens the measured text, so it wraps sooner', () => {
    const narrow = (letterSpacing?: number): AnyElement =>
      ({
        ...(spaced(letterSpacing) as object),
        bounds: { x: 0, y: 0, width: 60, height: 20 },
      }) as AnyElement;
    const lines = (ls?: number) =>
      (renderToSvg(template(narrow(ls)), { data: {} }).pages[0] as string).match(/<tspan/g)!.length;
    expect(lines(6)).toBeGreaterThan(lines());
  });

  it('leaves unspaced text byte-identical', async () => {
    const a = await renderToPdf(template(spaced()), { data: {} });
    const b = await renderToPdf(template(spaced(0)), { data: {} });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

describe('box padding insets the content (designer-ux 1.11)', () => {
  const padded = (
    padding?: { top: number; right: number; bottom: number; left: number },
    text = 'Padded',
    width = 200,
  ): AnyElement =>
    ({
      id: 't',
      type: 'staticText',
      bounds: { x: 0, y: 0, width, height: 20 },
      zIndex: 1,
      text,
      typography: { fontFamily: 'Helvetica', fontSize: 12 },
      ...(padding ? { box: { padding } } : {}),
    }) as AnyElement;
  const pad = (n: number) => ({ top: n, right: n, bottom: n, left: n });

  it('moves the text in from both edges in the SVG', () => {
    const bare = renderToSvg(template(padded()), { data: {} }).pages[0] as string;
    const inset = renderToSvg(template(padded(pad(10))), { data: {} }).pages[0] as string;
    const xy = (svg: string) => {
      const m = /<tspan x="([\d.]+)" y="([\d.]+)"/.exec(svg)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    expect(xy(inset).x - xy(bare).x).toBeCloseTo(10, 1);
    expect(xy(inset).y - xy(bare).y).toBeCloseTo(10, 1);
  });

  it('moves it by the same amount in the PDF', async () => {
    const ops = async (p?: ReturnType<typeof pad>) =>
      pdfOps((await renderToPdf(template(padded(p)), { data: {} })).bytes);
    const at = (s: string) => {
      const m = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/.exec(s)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const bare = at(await ops());
    const inset = at(await ops(pad(10)));
    expect(inset.x - bare.x).toBeCloseTo(10, 1);
    // PDF is bottom-up, so an inset from the top *lowers* the baseline
    expect(bare.y - inset.y).toBeCloseTo(10, 1);
  });

  it('narrows the column text wraps in', () => {
    // 200pt wide, 12pt font: the estimator gives 6pt per glyph, so ~33 fit.
    // 80pt of horizontal padding must force an extra line.
    const long = 'a'.repeat(30);
    const bare = renderToSvg(template(padded(undefined, long)), { data: {} }).pages[0] as string;
    const inset = renderToSvg(template(padded({ top: 0, right: 40, bottom: 0, left: 40 }, long)), {
      data: {},
    }).pages[0] as string;
    const lineCount = (svg: string) => (svg.match(/<tspan/g) ?? []).length;
    expect(lineCount(bare)).toBe(1);
    expect(lineCount(inset)).toBeGreaterThan(1);
  });

  it('grows an auto-sized box by the vertical padding', () => {
    const height = (p?: ReturnType<typeof pad>) =>
      layoutDocument(template(padded(p)), { data: {} }).pages[0]!.elements[0]!.bounds.height;
    // the box is 20pt and the text needs 14.4pt, so 10pt top+bottom pushes past it
    expect(height(pad(10))).toBeCloseTo(12 * 1.2 + 20, 1);
    expect(height()).toBe(20);
  });

  it('collapses rather than inverting when padded wider than the box', () => {
    const doc = layoutDocument(template(padded({ top: 0, right: 500, bottom: 0, left: 500 })), {
      data: {},
    });
    const el = doc.pages[0]!.elements[0]!;
    expect(el.bounds.width).toBeGreaterThan(0);
    expect(el.lines!.length).toBeGreaterThan(0);
  });

  it('leaves an unpadded element byte-identical', async () => {
    const a = await renderToPdf(template(padded()), { data: {} });
    const b = await renderToPdf(template(padded({ top: 0, right: 0, bottom: 0, left: 0 })), {
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
