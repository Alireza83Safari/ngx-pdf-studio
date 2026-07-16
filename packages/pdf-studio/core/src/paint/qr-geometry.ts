/**
 * Computes the dark-module rectangles for a {@link LaidQr}, in the element's
 * local top-left coordinates, including a 4-module quiet zone (required for
 * scanners) and centering the square code within the bounds. Consecutive dark
 * modules in a row merge into one rect. Shared by both painters so the SVG
 * preview and the PDF are identical (§7).
 */
import type { LaidQr } from '../layout/page';

export interface QrRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const QUIET_ZONE = 4;

export function qrRects(qr: LaidQr, width: number, height: number): QrRect[] {
  const total = qr.count + QUIET_ZONE * 2;
  const module = Math.min(width, height) / total;
  const offsetX = (width - module * total) / 2 + QUIET_ZONE * module;
  const offsetY = (height - module * total) / 2 + QUIET_ZONE * module;

  const rects: QrRect[] = [];
  for (let row = 0; row < qr.count; row++) {
    let runStart = -1;
    for (let col = 0; col <= qr.count; col++) {
      const dark = col < qr.count && (qr.modules[row]?.[col] ?? false);
      if (dark && runStart < 0) runStart = col;
      if (!dark && runStart >= 0) {
        rects.push({
          x: offsetX + runStart * module,
          y: offsetY + row * module,
          w: (col - runStart) * module,
          h: module,
        });
        runStart = -1;
      }
    }
  }
  return rects;
}
