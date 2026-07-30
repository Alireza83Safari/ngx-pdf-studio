/**
 * PDF painter: renders the shared `Page[]` layout tree to a real PDF via pdf-lib
 * (§10, ADR-0001) — selectable text, embedded/subset fonts, vector shapes. It
 * consumes the same layout tree as the SVG painter (§7), flipping from the
 * layout's top-left origin to PDF's bottom-left.
 *
 * Determinism: creation/modification dates and producer/creator are fixed, so
 * identical inputs yield identical bytes (snapshot + browser/Node parity, §3).
 *
 * Text is drawn per bidi run in visual order (`getVisualRuns`), each run in
 * logical order so fontkit shapes it (Arabic/Persian joining + ligatures); with
 * the bundled Vazirmatn font, mixed Persian/English/numbers render correctly
 * (§7, §11, ADR-0003). Text a fallback font cannot encode is skipped with a
 * non-fatal diagnostic rather than throwing (§9).
 *
 * Scope: text, rectangles, lines, ellipses, box fills/borders. Bitmap images and
 * advanced typography (justification, hyphenation) arrive later.
 */
import {
  cmyk,
  PDFBool,
  concatTransformationMatrix,
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFRawStream,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type Color as PdfLibColor,
  type PDFFont,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';
import type { ExpressionDiagnostic } from '../expression/errors';

// esbuild's browser IIFE bundle wraps this CJS module under `.default`, so the
// namespace itself has no `create`; Node keeps the API on the namespace. Pick
// whichever object actually carries the fontkit API so `registerFontkit` works
// in both the browser designer and Node.
const fontkit = (
  typeof (fontkitNs as { create?: unknown }).create === 'function'
    ? fontkitNs
    : (fontkitNs as unknown as { default: typeof fontkitNs }).default
) as typeof fontkitNs;
import { getVisualRuns } from '../i18n/bidi';
import { iconBox, iconTrianglePoints } from '../layout/conditional-visuals';
import type {
  BookmarkEntry,
  LaidOutElement,
  LayoutPage,
  PaginatedDocument,
  VectorOp,
} from '../layout/page';
import { chartOps } from './chart-ops';
import { colorToRgb01 } from './color';
import { qrRects } from './qr-geometry';
import { FontProvider, type FontInput } from './font-provider';
import {
  dashPattern,
  resolveBorderEdges,
  resolveBoxStyle,
  resolveTextStyle,
  type ResolvedTextStyle,
} from './paint-style';

const EPOCH = new Date(0);

export interface PdfPaintOptions {
  fonts?: FontInput[];
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string[] };
}

/** Render a paginated document to PDF bytes. */
export async function paintToPdf(
  doc: PaginatedDocument,
  options: PdfPaintOptions = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  pdf.setProducer('ngx-pdf-studio');
  pdf.setCreator('ngx-pdf-studio');
  pdf.setCreationDate(EPOCH);
  pdf.setModificationDate(EPOCH);
  if (options.metadata?.title) pdf.setTitle(options.metadata.title);
  if (options.metadata?.author) pdf.setAuthor(options.metadata.author);
  if (options.metadata?.subject) pdf.setSubject(options.metadata.subject);
  if (options.metadata?.keywords) pdf.setKeywords(options.metadata.keywords);
  attachXmpMetadata(pdf, options.metadata ?? {});

  const fonts = await FontProvider.create(pdf, options.fonts ?? []);

  const pdfPages: PDFPage[] = [];
  for (const page of doc.pages) {
    const pdfPage = pdf.addPage([page.size.width, page.size.height]);
    pdfPages.push(pdfPage);
    for (const el of page.elements) {
      await paintElement(pdf, pdfPage, el, page, fonts, doc.diagnostics);
    }
  }

  if (doc.bookmarks.length > 0) buildOutline(pdf, doc, pdfPages);
  buildLinks(pdf, doc, pdfPages);
  await buildFormFields(pdf, doc, pdfPages, fonts);

  // Field appearances were generated above with an embedded font (Persian
  // values crash pdf-lib's default WinAnsi appearance path).
  return pdf.save({ updateFieldAppearances: false });
}

/**
 * Create interactive AcroForm widgets (§11A-A) for elements with a resolved
 * `formField`: fillable text inputs and checkboxes, positioned at the element's
 * bounds. Duplicate field names are skipped with a non-fatal diagnostic (§9).
 */
async function buildFormFields(
  pdf: PDFDocument,
  doc: PaginatedDocument,
  pdfPages: PDFPage[],
  fonts: FontProvider,
): Promise<void> {
  const hasFields = doc.pages.some((p) => p.elements.some((e) => e.formField));
  if (!hasFields) return;
  const form = pdf.getForm();
  doc.pages.forEach((page, pi) => {
    const pdfPage = pdfPages[pi] as PDFPage;
    for (const el of page.elements) {
      const f = el.formField;
      if (!f) continue;
      const { x, y, width, height } = el.bounds;
      const rect = { x, y: page.size.height - (y + height), width, height };
      try {
        if (f.kind === 'checkbox') {
          const cb = form.createCheckBox(f.name);
          cb.addToPage(pdfPage, rect);
          if (f.checked) cb.check();
        } else {
          const tf = form.createTextField(f.name);
          if (f.multiline) tf.enableMultiline();
          // Add the (empty) widget first: addToPage builds an initial
          // appearance with the WinAnsi default font, which would throw on a
          // non-Latin value. The real appearance is generated below with an
          // embedded font after the text is set.
          tf.addToPage(pdfPage, rect);
          if (f.value) tf.setText(f.value);
        }
      } catch (err) {
        doc.diagnostics.push({
          severity: 'warning',
          message: `Could not create form field '${f.name}': ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  });

  // Generate widget appearances with an embedded font — the default WinAnsi
  // path cannot encode non-Latin (e.g. Persian) values. If even that fails,
  // ask viewers to regenerate appearances themselves (/NeedAppearances).
  try {
    form.updateFieldAppearances(await fonts.resolve({ bold: false, italic: false }));
  } catch {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  }
}

/**
 * Attach Link annotations for elements carrying a resolved `link` (§11A-D):
 * external URIs (`/URI`) or internal page jumps (`/GoTo`). Borderless; the hot
 * zone is the element's bounds. Verifiable with pdfjs `getAnnotations()`.
 */
function buildLinks(pdf: PDFDocument, doc: PaginatedDocument, pdfPages: PDFPage[]): void {
  const ctx = pdf.context;
  doc.pages.forEach((page, pi) => {
    const pdfPage = pdfPages[pi] as PDFPage;
    const pageHeight = page.size.height;
    for (const el of page.elements) {
      if (!el.link) continue;
      const { x, y, width, height } = el.bounds;
      const rect = ctx.obj([x, pageHeight - (y + height), x + width, pageHeight - y]);
      const action =
        el.link.kind === 'url'
          ? ctx.obj({ S: PDFName.of('URI'), URI: PDFString.of(el.link.url) })
          : ctx.obj({
              S: PDFName.of('GoTo'),
              D: ctx.obj([
                (pdfPages[clampPage(el.link.page, pdfPages.length)] as PDFPage).ref,
                PDFName.of('XYZ'),
                0,
                (
                  doc.pages[
                    clampPage(el.link.page, pdfPages.length)
                  ] as PaginatedDocument['pages'][number]
                ).size.height,
                PDFNull,
              ]),
            });
      const annotRef = ctx.register(
        ctx.obj({
          Type: PDFName.of('Annot'),
          Subtype: PDFName.of('Link'),
          Rect: rect,
          Border: ctx.obj([0, 0, 0]),
          A: action,
        }),
      );
      let annots = pdfPage.node.lookup(PDFName.of('Annots'), PDFArray);
      if (!annots) {
        annots = ctx.obj([]);
        pdfPage.node.set(PDFName.of('Annots'), annots);
      }
      annots.push(annotRef);
    }
  });
}

/** Clamp a 1-based page number to a valid 0-based index. */
const clampPage = (page: number, count: number): number =>
  Math.min(Math.max(page - 1, 0), count - 1);

const xmlEscape = (s: string): string => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Attach a deterministic XMP metadata packet as the catalog's `/Metadata`
 * (§11A-A). XMP is the modern, standards-compliant metadata channel (required
 * for PDF/A and tagged-PDF conformance) and mirrors the document-info dictionary
 * in Dublin Core + XMP-basic + PDF namespaces. The stream is left uncompressed,
 * as PDF/A requires. Dates are fixed to the epoch for byte determinism (§3).
 */
function attachXmpMetadata(
  pdf: PDFDocument,
  metadata: NonNullable<PdfPaintOptions['metadata']>,
): void {
  const date = '1970-01-01T00:00:00Z';
  const dc: string[] = [];
  if (metadata.title) {
    dc.push(
      `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.title)}</rdf:li></rdf:Alt></dc:title>`,
    );
  }
  if (metadata.author) {
    dc.push(
      `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(metadata.author)}</rdf:li></rdf:Seq></dc:creator>`,
    );
  }
  if (metadata.subject) {
    dc.push(
      `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.subject)}</rdf:li></rdf:Alt></dc:description>`,
    );
  }
  const keywords = metadata.keywords?.length
    ? `<pdf:Keywords>${xmlEscape(metadata.keywords.join(', '))}</pdf:Keywords>`
    : '';

  const xmp =
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n` +
    dc.join('\n') +
    (dc.length ? '\n' : '') +
    keywords +
    (keywords ? '\n' : '') +
    `<pdf:Producer>ngx-pdf-studio</pdf:Producer>\n` +
    `<xmp:CreatorTool>ngx-pdf-studio</xmp:CreatorTool>\n` +
    `<xmp:CreateDate>${date}</xmp:CreateDate>\n` +
    `<xmp:ModifyDate>${date}</xmp:ModifyDate>\n` +
    `</rdf:Description>\n</rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;

  const ctx = pdf.context;
  const bytes = new TextEncoder().encode(xmp);
  const stream = PDFRawStream.of(
    ctx.obj({ Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML'), Length: bytes.length }),
    bytes,
  );
  pdf.catalog.set(PDFName.of('Metadata'), ctx.register(stream));
}

async function paintElement(
  pdf: PDFDocument,
  page: PDFPage,
  el: LaidOutElement,
  layoutPage: LayoutPage,
  fonts: FontProvider,
  diagnostics: ExpressionDiagnostic[],
): Promise<void> {
  const rotated = el.rotation !== 0;
  if (rotated) beginRotation(page, el, layoutPage);
  try {
    await paintElementBody(pdf, page, el, layoutPage, fonts, diagnostics);
  } finally {
    if (rotated) page.pushOperators(popGraphicsState());
  }
}

/**
 * Push a graphics state that rotates subsequent operators clockwise by
 * `el.rotation` degrees about the element's center (§5), matching the SVG
 * painter's `rotate(deg cx cy)`. Layout is y-down but PDF is y-up, so the
 * visual-clockwise angle is negated in PDF space.
 */
function beginRotation(page: PDFPage, el: LaidOutElement, layoutPage: LayoutPage): void {
  const cx = el.bounds.x + el.bounds.width / 2;
  const cy = layoutPage.size.height - (el.bounds.y + el.bounds.height / 2);
  const rad = (-el.rotation * Math.PI) / 180;
  // Round so right angles produce exact 0/±1 entries (deterministic output).
  const round = (v: number): number => Math.round(v * 1e10) / 1e10;
  const cos = round(Math.cos(rad));
  const sin = round(Math.sin(rad));
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(1, 0, 0, 1, cx, cy),
    concatTransformationMatrix(cos, sin, -sin, cos, 0, 0),
    concatTransformationMatrix(1, 0, 0, 1, -cx, -cy),
  );
}

async function paintElementBody(
  pdf: PDFDocument,
  page: PDFPage,
  el: LaidOutElement,
  layoutPage: LayoutPage,
  fonts: FontProvider,
  diagnostics: ExpressionDiagnostic[],
): Promise<void> {
  switch (el.type) {
    case 'rectangle':
    case 'container':
    case 'spacer':
      paintBox(page, el, layoutPage);
      break;
    case 'image':
      paintBox(page, el, layoutPage);
      await paintImage(pdf, page, el, layoutPage, diagnostics);
      break;
    case 'chart':
      paintBox(page, el, layoutPage);
      await paintChart(page, el, layoutPage, fonts, diagnostics);
      break;
    case 'ellipse':
      paintEllipse(page, el, layoutPage);
      break;
    case 'line':
      paintLine(page, el, layoutPage);
      break;
    case 'barcode':
      paintBox(page, el, layoutPage);
      await paintBarcode(page, el, layoutPage, fonts);
      break;
    case 'qrcode':
      paintBox(page, el, layoutPage);
      paintQr(page, el, layoutPage);
      break;
    case 'richText':
      paintBox(page, el, layoutPage);
      await paintRichText(page, el, layoutPage, fonts, diagnostics);
      break;
    case 'custom':
      paintBox(page, el, layoutPage);
      await paintCustom(page, el, layoutPage, fonts, diagnostics);
      break;
    case 'staticText':
    case 'dataField':
    case 'pageField':
      paintBox(page, el, layoutPage);
      await paintText(page, el, layoutPage, fonts, diagnostics);
      break;
    default:
      paintBox(page, el, layoutPage);
  }
  if (el.icon) paintIcon(page, el, layoutPage);
}

/** Flip a layout-space top edge to a PDF-space bottom edge. */
const flipY = (layoutPage: LayoutPage, top: number, height: number): number =>
  layoutPage.size.height - top - height;

/** Draw a status-icon glyph at the element's start edge (§11A-D). */
function paintIcon(page: PDFPage, el: LaidOutElement, layoutPage: LayoutPage): void {
  if (!el.icon) return;
  const box = iconBox(el.bounds, el.direction);
  const color = toPdfColor(el.icon.color);
  if (el.icon.name === 'circle') {
    page.drawEllipse({
      x: box.x + box.size / 2,
      y: layoutPage.size.height - (box.y + box.size / 2),
      xScale: box.size / 2,
      yScale: box.size / 2,
      color,
    });
  } else if (el.icon.name === 'square') {
    page.drawRectangle({
      x: box.x,
      y: flipY(layoutPage, box.y, box.size),
      width: box.size,
      height: box.size,
      color,
    });
  } else {
    const pts = iconTrianglePoints(box, el.icon.name === 'triangleUp');
    const [p0, p1, p2] = pts as [[number, number], [number, number], [number, number]];
    // drawSvgPath anchors local (0,0) at (x,y) with y growing downward, so pass
    // the box's top edge in PDF coordinates and use absolute layout-space points.
    const d = `M ${p0[0]} ${p0[1]} L ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} Z`;
    page.drawSvgPath(d, { x: 0, y: layoutPage.size.height, color, scale: 1 });
  }
}

function paintBox(page: PDFPage, el: LaidOutElement, layoutPage: LayoutPage): void {
  const style = resolveBoxStyle(el);
  const edges = resolveBorderEdges(style.border);
  const { x, y, width, height } = el.bounds;
  const uniform = edges.uniform;
  if (style.fill || uniform) {
    const dash = uniform ? dashPattern(uniform) : undefined;
    page.drawRectangle({
      x,
      y: flipY(layoutPage, y, height),
      width,
      height,
      ...(style.fill ? { color: toPdfColor(style.fill) } : {}),
      ...(uniform ? { borderColor: toPdfColor(uniform.color), borderWidth: uniform.width } : {}),
      ...(dash ? { borderDashArray: dash } : {}),
      opacity: style.opacity,
      borderOpacity: style.opacity,
    });
  }
  // Individually declared sides are stroked as their own lines, matching the
  // SVG painter — a rectangle can only carry one uniform stroke.
  const top = flipY(layoutPage, y, 0);
  const bottom = flipY(layoutPage, y + height, 0);
  for (const { side, stroke } of edges.sides) {
    const [start, end] =
      side === 'top'
        ? [
            { x, y: top },
            { x: x + width, y: top },
          ]
        : side === 'bottom'
          ? [
              { x, y: bottom },
              { x: x + width, y: bottom },
            ]
          : side === 'left'
            ? [
                { x, y: top },
                { x, y: bottom },
              ]
            : [
                { x: x + width, y: top },
                { x: x + width, y: bottom },
              ];
    const dash = dashPattern(stroke);
    page.drawLine({
      start,
      end,
      thickness: stroke.width,
      color: toPdfColor(stroke.color),
      opacity: style.opacity,
      ...(dash ? { dashArray: dash } : {}),
    });
  }
  // Data bar above the fill, below content (§11A-D); grows from start edge.
  if (el.dataBar) {
    const w = width * el.dataBar.fraction;
    const bx = el.direction === 'rtl' ? x + width - w : x;
    page.drawRectangle({
      x: bx,
      y: flipY(layoutPage, y, height),
      width: w,
      height,
      color: toPdfColor(el.dataBar.color),
    });
  }
}

function paintEllipse(page: PDFPage, el: LaidOutElement, layoutPage: LayoutPage): void {
  const style = resolveBoxStyle(el);
  const side = style.border?.all; // an ellipse has no sides to declare individually
  const { x, y, width, height } = el.bounds;
  const dash = side ? dashPattern(side) : undefined;
  page.drawEllipse({
    x: x + width / 2,
    y: layoutPage.size.height - (y + height / 2),
    xScale: width / 2,
    yScale: height / 2,
    ...(style.fill ? { color: toPdfColor(style.fill) } : {}),
    ...(side ? { borderColor: toPdfColor(side.color), borderWidth: side.width } : {}),
    ...(dash ? { borderDashArray: dash } : {}),
  });
}

/** Draw barcode module bits as merged black bars (vector) across the bounds. */
const BARCODE_TEXT_HEIGHT = 10;

async function paintBarcode(
  page: PDFPage,
  el: LaidOutElement,
  layoutPage: LayoutPage,
  fonts: FontProvider,
): Promise<void> {
  const bits = el.barcode;
  if (!bits || bits.length === 0) return;
  const { x, y, width, height } = el.bounds;
  const hasText = el.barcodeText !== undefined && el.barcodeText !== '';
  const barHeight = hasText ? Math.max(0, height - BARCODE_TEXT_HEIGHT) : height;
  const moduleWidth = width / bits.length;
  const black = rgb(0, 0, 0);
  let runStart = -1;
  for (let i = 0; i <= bits.length; i++) {
    const on = i < bits.length && bits[i];
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      page.drawRectangle({
        x: x + runStart * moduleWidth,
        y: flipY(layoutPage, y, barHeight),
        width: (i - runStart) * moduleWidth,
        height: barHeight,
        color: black,
      });
      runStart = -1;
    }
  }
  if (hasText) {
    const value = el.barcodeText as string;
    const fontSize = BARCODE_TEXT_HEIGHT * 0.85;
    const font = await fonts.resolve({ bold: false, italic: false });
    const textWidth = font.widthOfTextAtSize(value, fontSize);
    page.drawText(value, {
      x: x + (width - textWidth) / 2,
      y:
        flipY(layoutPage, y + barHeight, BARCODE_TEXT_HEIGHT) +
        (BARCODE_TEXT_HEIGHT - fontSize) / 2,
      size: fontSize,
      font,
      color: black,
    });
  }
}

async function paintImage(
  pdf: PDFDocument,
  page: PDFPage,
  el: LaidOutElement,
  layoutPage: LayoutPage,
  diagnostics: ExpressionDiagnostic[],
): Promise<void> {
  const img = el.image;
  if (!img) return;
  if (!img.base64) {
    diagnostics.push({
      severity: 'warning',
      message: `Image '${el.id}' has no embeddable bytes (URL images are not embedded in the PDF path yet)`,
    });
    return;
  }
  let embedded;
  try {
    // pdf-lib accepts a base64 string directly for embedPng/embedJpg.
    embedded =
      img.mime === 'image/jpeg' ? await pdf.embedJpg(img.base64) : await pdf.embedPng(img.base64);
  } catch (err) {
    diagnostics.push({
      severity: 'warning',
      message: `Could not embed image '${el.id}': ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const { x, y, width, height } = el.bounds;
  const iw = embedded.width;
  const ih = embedded.height;
  let dw = width;
  let dh = height;
  if (img.fit === 'contain' || img.fit === 'cover') {
    const scale =
      img.fit === 'contain' ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
    dw = iw * scale;
    dh = ih * scale;
  } else if (img.fit === 'none') {
    dw = iw;
    dh = ih;
  }
  const dx = x + (width - dw) / 2;
  const dy = y + (height - dh) / 2;
  page.drawImage(embedded, { x: dx, y: layoutPage.size.height - (dy + dh), width: dw, height: dh });
}

async function paintChart(
  page: PDFPage,
  el: LaidOutElement,
  layoutPage: LayoutPage,
  fonts: FontProvider,
  diagnostics: ExpressionDiagnostic[],
): Promise<void> {
  const chart = el.chart;
  if (!chart) return;
  await paintOps(
    page,
    chartOps(chart, el.bounds.width, el.bounds.height),
    el,
    layoutPage,
    fonts,
    diagnostics,
  );
}

/** Vector ops from a registered custom-element renderer (§12). */
async function paintCustom(
  page: PDFPage,
  el: LaidOutElement,
  layoutPage: LayoutPage,
  fonts: FontProvider,
  diagnostics: ExpressionDiagnostic[],
): Promise<void> {
  if (el.custom) await paintOps(page, el.custom, el, layoutPage, fonts, diagnostics);
}

/** Draw neutral vector ops (element-local space) at the element's position (§7). */
async function paintOps(
  page: PDFPage,
  ops: readonly VectorOp[],
  el: LaidOutElement,
  layoutPage: LayoutPage,
  fonts: FontProvider,
  diagnostics: ExpressionDiagnostic[],
): Promise<void> {
  const { x, y } = el.bounds;
  for (const c of ops) {
    if (c.op === 'rect') {
      page.drawRectangle({
        x: x + c.x,
        y: flipY(layoutPage, y + c.y, c.h),
        width: c.w,
        height: c.h,
        color: rgb(c.fill.r, c.fill.g, c.fill.b),
      });
    } else if (c.op === 'path') {
      // drawSvgPath anchors the path (y-down) at the element's top-left.
      page.drawSvgPath(c.d, {
        x,
        y: layoutPage.size.height - y,
        color: rgb(c.fill.r, c.fill.g, c.fill.b),
      });
    } else if (c.op === 'text') {
      const font = await fonts.resolve({ bold: false, italic: false });
      try {
        let tx = x + c.x;
        if (c.align === 'middle' || c.align === 'end') {
          const w = font.widthOfTextAtSize(c.text, c.size);
          tx -= c.align === 'middle' ? w / 2 : w;
        }
        page.drawText(c.text, {
          x: tx,
          y: layoutPage.size.height - (y + c.y),
          size: c.size,
          font,
          color: rgb(c.color.r, c.color.g, c.color.b),
        });
      } catch (err) {
        // e.g. a WinAnsi fallback font cannot encode a Persian label (§9).
        diagnostics.push({
          severity: 'warning',
          message: `Chart label '${truncate(c.text)}' could not be drawn: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      page.drawLine({
        start: { x: x + c.x1, y: layoutPage.size.height - (y + c.y1) },
        end: { x: x + c.x2, y: layoutPage.size.height - (y + c.y2) },
        thickness: c.width,
        color: rgb(c.color.r, c.color.g, c.color.b),
      });
    }
  }
}

function paintQr(page: PDFPage, el: LaidOutElement, layoutPage: LayoutPage): void {
  const qr = el.qr;
  if (!qr) return;
  const { x, y } = el.bounds;
  const black = rgb(0, 0, 0);
  for (const rt of qrRects(qr, el.bounds.width, el.bounds.height)) {
    page.drawRectangle({
      x: x + rt.x,
      y: flipY(layoutPage, y + rt.y, rt.h),
      width: rt.w,
      height: rt.h,
      color: black,
    });
  }
}

function paintLine(page: PDFPage, el: LaidOutElement, layoutPage: LayoutPage): void {
  const stroke = el.source.type === 'line' ? el.source.stroke : undefined;
  const { x, y, width, height } = el.bounds;
  const dash = stroke ? dashPattern(stroke) : undefined;
  page.drawLine({
    start: { x, y: layoutPage.size.height - y },
    end: { x: x + width, y: layoutPage.size.height - (y + height) },
    thickness: stroke?.width ?? 1,
    color: stroke ? toPdfColor(stroke.color) : rgb(0, 0, 0),
    ...(dash ? { dashArray: dash } : {}),
  });
}

async function paintText(
  page: PDFPage,
  el: LaidOutElement,
  layoutPage: LayoutPage,
  fonts: FontProvider,
  diagnostics: ExpressionDiagnostic[],
): Promise<void> {
  if (el.text === undefined) return;
  const style = resolveTextStyle(el);
  const font = await fonts.resolve({
    bold: style.bold,
    italic: style.italic,
    ...(style.fontFamily !== undefined ? { fontFamily: style.fontFamily } : {}),
  });
  const lines = el.lines ?? [el.text];
  const ascent = style.fontSize * 0.8;
  const color = toPdfColor(style.color);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const baselineY = layoutPage.size.height - (el.bounds.y + i * style.lineHeight + ascent);
    // Split the line into directional runs in visual order; each run is drawn in
    // logical order so fontkit shapes (joins) it correctly (§7, §11, ADR-0003).
    const runs = getVisualRuns(line).map((run) => drawText(run));
    const widths = runs.map((run) => safeWidth(font, run, style.fontSize));
    const total = widths.reduce((a, b) => a + b, 0);
    const lineX = lineStartX(el.bounds.x, el.bounds.width, style.align, total);
    let x = lineX;

    runs.forEach((run, idx) => {
      try {
        page.drawText(run, { x, y: baselineY, size: style.fontSize, font, color });
      } catch (err) {
        diagnostics.push({
          severity: 'warning',
          message: `Could not render text '${truncate(run)}' with the selected font: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
      x += widths[idx] as number;
    });

    // `resolveTextStyle` has always resolved `underline`, and the SVG painter has
    // always drawn it — this side never did, so a decorated element previewed
    // underlined and printed plain. The two painters have to agree (§7).
    if (style.underline && total > 0) {
      drawUnderline(page, lineX, baselineY, total, style.fontSize, color);
    }
  }
}

/** A decoration rule under one run of text, in PDF (bottom-up) coordinates. */
function drawUnderline(
  page: PDFPage,
  x: number,
  baselineY: number,
  width: number,
  fontSize: number,
  color: ReturnType<typeof toPdfColor>,
): void {
  const thickness = Math.max(0.4, fontSize / 16);
  const y = baselineY - fontSize * 0.12;
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness, color });
}

/**
 * Build the PDF outline (/Outlines) tree from the document's bookmark entries
 * (§11A-D). Entries are nested by `level`; each item links to its page via an
 * XYZ destination at the element's top. Verifiable with pdfjs `getOutline()`.
 */
function buildOutline(pdf: PDFDocument, doc: PaginatedDocument, pdfPages: PDFPage[]): void {
  const ctx = pdf.context;
  const marks = doc.bookmarks;
  const refs = marks.map(() => ctx.nextRef());
  const outlinesRef = ctx.nextRef();

  // parent[i] = nearest earlier entry with a smaller level (-1 = root).
  const parent: number[] = [];
  const childrenOf = new Map<number, number[]>();
  const stack: number[] = [];
  marks.forEach((mark, i) => {
    while (
      stack.length > 0 &&
      (marks[stack[stack.length - 1] as number] as BookmarkEntry).level >= mark.level
    ) {
      stack.pop();
    }
    const p = stack.length > 0 ? (stack[stack.length - 1] as number) : -1;
    parent[i] = p;
    const siblings = childrenOf.get(p) ?? [];
    siblings.push(i);
    childrenOf.set(p, siblings);
    stack.push(i);
  });

  const descendants = (i: number): number => {
    const kids = childrenOf.get(i) ?? [];
    return kids.reduce((sum, k) => sum + 1 + descendants(k), 0);
  };

  const destOf = (i: number) => {
    const mark = marks[i] as BookmarkEntry;
    const page = doc.pages[mark.pageIndex] as PaginatedDocument['pages'][number];
    const top = page.size.height - mark.y;
    return ctx.obj([(pdfPages[mark.pageIndex] as PDFPage).ref, PDFName.of('XYZ'), 0, top, PDFNull]);
  };

  marks.forEach((mark, i) => {
    const siblings = childrenOf.get(parent[i] as number) as number[];
    const pos = siblings.indexOf(i);
    const kids = childrenOf.get(i) ?? [];
    ctx.assign(
      refs[i] as PDFRef,
      ctx.obj({
        Title: PDFHexString.fromText(mark.title),
        Parent: parent[i] === -1 ? outlinesRef : (refs[parent[i] as number] as PDFRef),
        Dest: destOf(i),
        ...(pos > 0 ? { Prev: refs[siblings[pos - 1] as number] as PDFRef } : {}),
        ...(pos < siblings.length - 1 ? { Next: refs[siblings[pos + 1] as number] as PDFRef } : {}),
        ...(kids.length > 0
          ? {
              First: refs[kids[0] as number] as PDFRef,
              Last: refs[kids[kids.length - 1] as number] as PDFRef,
              Count: descendants(i),
            }
          : {}),
      }),
    );
  });

  const top = childrenOf.get(-1) ?? [];
  ctx.assign(
    outlinesRef,
    ctx.obj({
      Type: PDFName.of('Outlines'),
      ...(top.length > 0
        ? {
            First: refs[top[0] as number] as PDFRef,
            Last: refs[top[top.length - 1] as number] as PDFRef,
            Count: marks.length,
          }
        : {}),
    }),
  );
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef);
}

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

/**
 * Prepare a visual run's text for pdf-lib's `drawText`, which delegates to
 * fontkit `layout` — and fontkit reverses Arabic-script glyphs (correct for
 * Persian letters, which we keep logical). But Arabic-Indic **digits** are
 * Arabic-script too, so fontkit reverses a numeric run that bidi already
 * resolved as left-to-right. We pre-reverse such LTR digit runs so fontkit's
 * reversal cancels out and numbers/dates read correctly (§11).
 */
function drawText(run: { text: string; rtl: boolean }): string {
  if (!run.rtl && ARABIC_INDIC_DIGITS.test(run.text)) {
    return [...run.text].reverse().join('');
  }
  return run.text;
}

async function paintRichText(
  page: PDFPage,
  el: LaidOutElement,
  layoutPage: LayoutPage,
  fonts: FontProvider,
  diagnostics: ExpressionDiagnostic[],
): Promise<void> {
  const rt = el.richText;
  if (!rt) return;
  const black = rgb(0, 0, 0);
  let cursorY = 0;
  for (const para of rt.paragraphs) {
    for (const line of para.lines) {
      const ascent = Math.max(0, ...line.runs.map((r) => r.fontSize)) * 0.8;
      const baselineY = layoutPage.size.height - (el.bounds.y + cursorY + ascent);
      let x = lineStartXForPara(el.bounds.x, el.bounds.width, para.align, line.width);
      for (const run of line.runs) {
        const font = await fonts.resolve({
          bold: run.bold,
          italic: run.italic,
          ...(run.fontFamily !== undefined ? { fontFamily: run.fontFamily } : {}),
        });
        try {
          page.drawText(run.text, { x, y: baselineY, size: run.fontSize, font, color: black });
        } catch (err) {
          diagnostics.push({
            severity: 'warning',
            message: `Could not render rich-text run '${truncate(run.text)}': ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        // same divergence as plain text: the SVG painter underlines runs, this
        // one did not
        if (run.underline && run.width > 0) {
          drawUnderline(page, x, baselineY, run.width, run.fontSize, black);
        }
        x += run.width;
      }
      cursorY += line.height;
    }
  }
}

function lineStartXForPara(x: number, width: number, align: string, lineWidth: number): number {
  if (align === 'center') return x + (width - lineWidth) / 2;
  if (align === 'right' || align === 'end') return x + width - lineWidth;
  return x;
}

function safeWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return 0;
  }
}

/** Left x for a line given physical alignment and the line's total width. */
function lineStartX(
  x: number,
  width: number,
  align: ResolvedTextStyle['align'],
  total: number,
): number {
  if (align === 'left' || align === 'justify') return x;
  return align === 'center' ? x + (width - total) / 2 : x + width - total;
}

/**
 * Map a model color to a pdf-lib color. CMYK is emitted as true `DeviceCMYK`
 * (`k`/`K` operators) for accurate print output (§11A-B); RGB and spot
 * (via its RGB approximation) become `DeviceRGB`.
 */
function toPdfColor(color: Parameters<typeof colorToRgb01>[0]): PdfLibColor {
  if (color.space === 'cmyk') return cmyk(color.c, color.m, color.y, color.k);
  const { r, g, b } = colorToRgb01(color);
  return rgb(r, g, b);
}

const truncate = (s: string): string => (s.length > 20 ? `${s.slice(0, 20)}…` : s);
