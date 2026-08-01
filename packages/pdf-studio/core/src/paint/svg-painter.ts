/**
 * Preview painter: renders the shared `Page[]` layout tree to SVG (§7). SVG uses
 * the same top-left coordinate system as the layout tree, so no flip is needed.
 * Output is deterministic (coordinates rounded) for snapshot testing. The
 * designer canvas and live preview consume this; it never recomputes layout.
 */
import { paddedRect, resolvePadding } from '../layout/box-padding';
import { iconBox, iconTrianglePoints } from '../layout/conditional-visuals';
import type { LaidOutElement, LayoutPage, PaginatedDocument, VectorOp } from '../layout/page';
import { chartOps } from './chart-ops';
import { colorToCss } from './color';
import { qrRects } from './qr-geometry';
import {
  dashPattern,
  resolveBorderEdges,
  resolveBoxStyle,
  resolveTextStyle,
  verticalOffset,
} from './paint-style';
import type { BorderSide } from '../model/style';

const rgb01ToCss = (c: { r: number; g: number; b: number }): string =>
  `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;

const r2 = (n: number): string => (Math.round(n * 100) / 100).toString();

const escapeXml = (s: string): string =>
  s.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  );

/** Render a single page to an `<svg>` element string. */
export function paintPageToSvg(page: LayoutPage): string {
  const body = page.elements.map(paintElement).filter(Boolean).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(page.size.width)}" ` +
    `height="${r2(page.size.height)}" viewBox="0 0 ${r2(page.size.width)} ${r2(page.size.height)}">` +
    body +
    `</svg>`
  );
}

/** Render every page; returns one SVG string per page. */
export function paintToSvg(doc: PaginatedDocument): string[] {
  return doc.pages.map(paintPageToSvg);
}

function paintElement(el: LaidOutElement): string {
  const markup = paintElementBody(el) + iconMarkup(el);
  if (!markup || !el.rotation) return markup;
  // Clockwise rotation about the element's center (§5).
  const cx = el.bounds.x + el.bounds.width / 2;
  const cy = el.bounds.y + el.bounds.height / 2;
  return `<g transform="rotate(${r2(el.rotation)} ${r2(cx)} ${r2(cy)})">${markup}</g>`;
}

/** Status-icon glyph drawn at the element's start edge (§11A-D). */
function iconMarkup(el: LaidOutElement): string {
  if (!el.icon) return '';
  const box = iconBox(el.bounds, el.direction);
  const fill = colorToCss(el.icon.color);
  switch (el.icon.name) {
    case 'circle':
      return `<circle cx="${r2(box.x + box.size / 2)}" cy="${r2(box.y + box.size / 2)}" r="${r2(box.size / 2)}" fill="${fill}" />`;
    case 'square':
      return `<rect x="${r2(box.x)}" y="${r2(box.y)}" width="${r2(box.size)}" height="${r2(box.size)}" fill="${fill}" />`;
    case 'triangleUp':
    case 'triangleDown': {
      const pts = iconTrianglePoints(box, el.icon.name === 'triangleUp')
        .map(([px, py]) => `${r2(px)},${r2(py)}`)
        .join(' ');
      return `<polygon points="${pts}" fill="${fill}" />`;
    }
  }
}

function paintElementBody(el: LaidOutElement): string {
  const box = boxMarkup(el);
  switch (el.type) {
    case 'rectangle':
    case 'container':
    case 'spacer':
      return box;
    case 'image':
      return box + imageMarkup(el);
    case 'chart':
      return box + chartMarkup(el);
    case 'ellipse':
      return box + ellipseMarkup(el);
    case 'line':
      return lineMarkup(el);
    case 'barcode':
      return box + barcodeMarkup(el);
    case 'qrcode':
      return box + qrMarkup(el);
    case 'richText':
      return box + richTextMarkup(el);
    case 'staticText':
    case 'dataField':
    case 'pageField':
      return box + textMarkup(el);
    case 'formField':
      return box + formFieldMarkup(el);
    case 'custom':
      return box + customMarkup(el);
    default:
      return box;
  }
}

/** Preview placeholder for an interactive form field (§11A-A). */
function formFieldMarkup(el: LaidOutElement): string {
  const f = el.formField;
  if (!f) return '';
  const { x, y, width, height } = el.bounds;
  const border = `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(width)}" height="${r2(height)}" fill="none" stroke="rgb(120, 120, 120)" stroke-width="0.5" />`;
  if (f.kind === 'checkbox') {
    if (!f.checked) return border;
    const m = Math.min(width, height) * 0.2;
    return (
      border +
      `<path d="M${r2(x + m)} ${r2(y + height / 2)} L${r2(x + width * 0.42)} ${r2(y + height - m)} L${r2(x + width - m)} ${r2(y + m)}" fill="none" stroke="rgb(0, 0, 0)" stroke-width="${r2(Math.min(width, height) * 0.12)}" />`
    );
  }
  if (!f.value) return border;
  const fontSize = Math.min(height * 0.7, 12);
  return (
    border +
    `<text x="${r2(x + 2)}" y="${r2(y + height * 0.72)}" font-size="${r2(fontSize)}" font-family="sans-serif">${escapeXml(f.value)}</text>`
  );
}

function physical(align: string, direction: 'ltr' | 'rtl'): 'left' | 'center' | 'right' {
  if (align === 'center') return 'center';
  if (
    align === 'right' ||
    (align === 'end' && direction === 'ltr') ||
    (align === 'start' && direction === 'rtl')
  ) {
    return 'right';
  }
  return 'left';
}

function richTextMarkup(el: LaidOutElement): string {
  const rt = el.richText;
  if (!rt) return '';
  const { x, y, width } = el.bounds;
  let out = '';
  let cursorY = 0;
  for (const para of rt.paragraphs) {
    const phys = physical(para.align, el.direction);
    for (const line of para.lines) {
      const baseline = y + cursorY + line.height * 0.8;
      let runX =
        phys === 'center'
          ? x + (width - line.width) / 2
          : phys === 'right'
            ? x + width - line.width
            : x;
      const tspans = line.runs
        .map((run) => {
          const attrs = [
            `x="${r2(runX)}"`,
            `y="${r2(baseline)}"`,
            `font-size="${r2(run.fontSize)}"`,
            run.fontFamily
              ? `font-family="${escapeXml(run.fontFamily)}"`
              : 'font-family="sans-serif"',
            run.bold ? `font-weight="bold"` : '',
            run.italic ? `font-style="italic"` : '',
            run.underline ? `text-decoration="underline"` : '',
          ]
            .filter(Boolean)
            .join(' ');
          runX += run.width;
          return `<tspan ${attrs}>${escapeXml(run.text)}</tspan>`;
        })
        .join('');
      out += `<text fill="rgb(0, 0, 0)" ${el.direction === 'rtl' ? 'direction="rtl" ' : ''}>${tspans}</text>`;
      cursorY += line.height;
    }
  }
  return out;
}

const PRESERVE: Record<string, string> = {
  contain: 'xMidYMid meet',
  cover: 'xMidYMid slice',
  fill: 'none',
  none: 'xMidYMid meet',
};

function imageMarkup(el: LaidOutElement): string {
  const img = el.image;
  if (!img) return '';
  const href = img.base64 ? `data:${img.mime};base64,${img.base64}` : (img.url ?? '');
  if (!href) return '';
  const { x, y, width, height } = el.bounds;
  return (
    `<image x="${r2(x)}" y="${r2(y)}" width="${r2(width)}" height="${r2(height)}" ` +
    `preserveAspectRatio="${PRESERVE[img.fit] ?? 'xMidYMid meet'}" href="${escapeXml(href)}" />`
  );
}

function chartMarkup(el: LaidOutElement): string {
  const chart = el.chart;
  if (!chart) return '';
  return opsMarkup(chartOps(chart, el.bounds.width, el.bounds.height), el.bounds.x, el.bounds.y);
}

/** Vector ops from a registered custom-element renderer (§12). */
function customMarkup(el: LaidOutElement): string {
  return el.custom ? opsMarkup(el.custom, el.bounds.x, el.bounds.y) : '';
}

/** Draw neutral vector ops (local space) translated to page position (§7). */
function opsMarkup(ops: readonly VectorOp[], x: number, y: number): string {
  return ops
    .map((c) => {
      if (c.op === 'rect') {
        return `<rect x="${r2(x + c.x)}" y="${r2(y + c.y)}" width="${r2(c.w)}" height="${r2(c.h)}" fill="${rgb01ToCss(c.fill)}" />`;
      }
      if (c.op === 'path') {
        return `<path transform="translate(${r2(x)} ${r2(y)})" d="${c.d}" fill="${rgb01ToCss(c.fill)}" />`;
      }
      if (c.op === 'text') {
        const anchor = c.align === 'middle' ? 'middle' : c.align === 'end' ? 'end' : 'start';
        // Vector ops carry *physical* positions (the PDF painter offsets by the
        // measured width). Inline SVG inherits `direction` from the host page, so
        // on an RTL page `text-anchor="start"` would mean the right edge and every
        // chart legend/axis label would render mirrored onto its own swatch.
        return `<text x="${r2(x + c.x)}" y="${r2(y + c.y)}" font-size="${r2(c.size)}" font-family="Vazirmatn, sans-serif" direction="ltr" text-anchor="${anchor}" fill="${rgb01ToCss(c.color)}">${escapeXml(c.text)}</text>`;
      }
      return `<line x1="${r2(x + c.x1)}" y1="${r2(y + c.y1)}" x2="${r2(x + c.x2)}" y2="${r2(y + c.y2)}" stroke="${rgb01ToCss(c.color)}" stroke-width="${r2(c.width)}" />`;
    })
    .join('');
}

function qrMarkup(el: LaidOutElement): string {
  const qr = el.qr;
  if (!qr) return '';
  const { x, y, width, height } = el.bounds;
  return qrRects(qr, width, height)
    .map(
      (rt) =>
        `<rect x="${r2(x + rt.x)}" y="${r2(y + rt.y)}" width="${r2(rt.w)}" height="${r2(rt.h)}" fill="rgb(0, 0, 0)" />`,
    )
    .join('');
}

/** Draw barcode module bits as merged black bars across the element bounds. */
const BARCODE_TEXT_HEIGHT = 10;

function barcodeMarkup(el: LaidOutElement): string {
  const bits = el.barcode;
  if (!bits || bits.length === 0) return '';
  const { x, y, width, height } = el.bounds;
  const hasText = el.barcodeText !== undefined && el.barcodeText !== '';
  const barHeight = hasText ? Math.max(0, height - BARCODE_TEXT_HEIGHT) : height;
  const moduleWidth = width / bits.length;
  let rects = '';
  let runStart = -1;
  for (let i = 0; i <= bits.length; i++) {
    const on = i < bits.length && bits[i];
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      const bx = x + runStart * moduleWidth;
      rects += `<rect x="${r2(bx)}" y="${r2(y)}" width="${r2((i - runStart) * moduleWidth)}" height="${r2(barHeight)}" fill="rgb(0, 0, 0)" />`;
      runStart = -1;
    }
  }
  if (hasText) {
    const fontSize = BARCODE_TEXT_HEIGHT * 0.85;
    rects += `<text x="${r2(x + width / 2)}" y="${r2(y + barHeight + fontSize)}" font-size="${r2(fontSize)}" font-family="monospace" text-anchor="middle" fill="rgb(0, 0, 0)">${escapeXml(el.barcodeText as string)}</text>`;
  }
  return rects;
}

/** `stroke-dasharray` for a stroke style, or '' when solid. */
function dashAttr(stroke: BorderSide): string {
  const dash = dashPattern(stroke);
  return dash ? `stroke-dasharray="${dash.map(r2).join(' ')}"` : '';
}

function boxMarkup(el: LaidOutElement): string {
  const { fill, border, opacity, radius } = resolveBoxStyle(el);
  const edges = resolveBorderEdges(border);
  const bar = dataBarMarkup(el);
  if (!fill && !edges.uniform && edges.sides.length === 0) return bar;
  const { x, y, width, height } = el.bounds;
  const attrs = [
    `x="${r2(x)}"`,
    `y="${r2(y)}"`,
    `width="${r2(width)}"`,
    `height="${r2(height)}"`,
    fill ? `fill="${colorToCss(fill)}"` : `fill="none"`,
    edges.uniform
      ? `stroke="${colorToCss(edges.uniform.color)}" stroke-width="${r2(edges.uniform.width)}"`
      : '',
    edges.uniform ? dashAttr(edges.uniform) : '',
    radius !== undefined ? `rx="${r2(radius)}"` : '',
    opacity < 1 ? `opacity="${opacity}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  // Individually declared sides are stroked as their own lines; a rectangle can
  // only carry one uniform stroke.
  const sides = edges.sides
    .map(({ side, stroke }) => {
      const [x1, y1, x2, y2] =
        side === 'top'
          ? [x, y, x + width, y]
          : side === 'bottom'
            ? [x, y + height, x + width, y + height]
            : side === 'left'
              ? [x, y, x, y + height]
              : [x + width, y, x + width, y + height];
      return (
        `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" ` +
        `stroke="${colorToCss(stroke.color)}" stroke-width="${r2(stroke.width)}" ${dashAttr(stroke)} />`
      );
    })
    .join('');
  return `<rect ${attrs} />` + bar + sides;
}

/** Proportional data bar drawn above the box fill, below content (§11A-D). */
function dataBarMarkup(el: LaidOutElement): string {
  const bar = el.dataBar;
  if (!bar) return '';
  const { x, y, width, height } = el.bounds;
  const w = width * bar.fraction;
  const bx = el.direction === 'rtl' ? x + width - w : x;
  return `<rect x="${r2(bx)}" y="${r2(y)}" width="${r2(w)}" height="${r2(height)}" fill="${colorToCss(bar.color)}" />`;
}

function ellipseMarkup(el: LaidOutElement): string {
  const { fill, border } = resolveBoxStyle(el);
  const { x, y, width, height } = el.bounds;
  const side = border?.all; // an ellipse has no sides to declare individually
  const attrs = [
    `cx="${r2(x + width / 2)}"`,
    `cy="${r2(y + height / 2)}"`,
    `rx="${r2(width / 2)}"`,
    `ry="${r2(height / 2)}"`,
    fill ? `fill="${colorToCss(fill)}"` : `fill="none"`,
    side ? `stroke="${colorToCss(side.color)}" stroke-width="${r2(side.width)}"` : '',
    side ? dashAttr(side) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<ellipse ${attrs} />`;
}

function lineMarkup(el: LaidOutElement): string {
  const source = el.source;
  const stroke = source.type === 'line' ? source.stroke : undefined;
  const { x, y, width, height } = el.bounds;
  const color = stroke ? colorToCss(stroke.color) : 'rgb(0, 0, 0)';
  const w = stroke ? stroke.width : 1;
  const dash = stroke ? dashAttr(stroke) : '';
  return (
    `<line x1="${r2(x)}" y1="${r2(y)}" x2="${r2(x + width)}" y2="${r2(y + height)}" ` +
    `stroke="${color}" stroke-width="${r2(w)}" ${dash}/>`
  );
}

function textMarkup(el: LaidOutElement): string {
  if (el.text === undefined) return '';
  const style = resolveTextStyle(el);
  const lines = el.lines ?? [el.text];
  // text sits inside the padding, not against the element edge (designer-ux 1.11)
  const { x, y, width, height } = paddedRect(el.bounds, resolvePadding(el.box));

  // `style.align` is already *physical* (paint-style resolves start/end against
  // the direction), but SVG's `text-anchor` is *logical* — under
  // `direction="rtl"` "start" is the right edge. Emitting the logical name that
  // matches the physical edge keeps the preview on the same geometry as the PDF
  // painter's `lineStartX`; without this every non-centered line on an RTL page
  // is displaced by its own width.
  const rtl = el.direction === 'rtl';
  const anchor =
    style.align === 'center'
      ? 'middle'
      : style.align === 'right'
        ? rtl
          ? 'start'
          : 'end'
        : rtl
          ? 'end'
          : 'start';
  const tx = style.align === 'center' ? x + width / 2 : style.align === 'right' ? x + width : x;

  // both decorations can apply at once, and CSS takes them space-separated
  const decorations = [style.underline ? 'underline' : '', style.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ');

  const fontStyle = [
    `font-family="${escapeXml(style.fontFamily ?? 'sans-serif')}"`,
    `font-size="${r2(style.fontSize)}"`,
    style.bold ? `font-weight="bold"` : '',
    style.italic ? `font-style="italic"` : '',
    decorations ? `text-decoration="${decorations}"` : '',
    `fill="${colorToCss(style.color)}"`,
    `text-anchor="${anchor}"`,
    el.direction === 'rtl' ? `direction="rtl"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const vShift = verticalOffset(style, height, lines.length);
  const tspans = lines
    .map((line, i) => {
      const lineY = y + vShift + style.fontSize + i * style.lineHeight;
      return `<tspan x="${r2(tx)}" y="${r2(lineY)}">${escapeXml(line)}</tspan>`;
    })
    .join('');

  return `<text ${fontStyle}>${tspans}</text>`;
}
