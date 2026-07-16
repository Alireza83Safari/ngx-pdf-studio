/**
 * Barcode symbology registry (§5, §12). Maps a {@link BarcodeSymbology} to an
 * encoder producing module bits. Code 39 ships built-in; other symbologies
 * (Code128, EAN, QR via a 2D variant, …) register through
 * `PdfStudio.registerBarcode` without forking. Unknown symbologies return
 * `undefined`, which the layout treats as a non-fatal skip (§9).
 */
import type { BarcodeSymbology } from '../model/elements';
import { encodeCode39 } from './code39';
import { encodeCode128 } from './code128';
import { encodeEan13 } from './ean13';

/** Encodes a value into a 1-D module bit array (`true` = bar). */
export type BarcodeEncoder = (value: string) => boolean[];

export class BarcodeRegistry {
  private readonly encoders = new Map<string, BarcodeEncoder>();

  register(symbology: string, encoder: BarcodeEncoder): this {
    this.encoders.set(symbology, encoder);
    return this;
  }

  has(symbology: string): boolean {
    return this.encoders.has(symbology);
  }

  encode(symbology: BarcodeSymbology | string, value: string): boolean[] | undefined {
    return this.encoders.get(symbology)?.(value);
  }

  clone(): BarcodeRegistry {
    const copy = new BarcodeRegistry();
    for (const [name, encoder] of this.encoders) copy.register(name, encoder);
    return copy;
  }
}

/** Registry seeded with the built-in symbologies. */
export function createDefaultBarcodes(): BarcodeRegistry {
  return new BarcodeRegistry()
    .register('code39', encodeCode39)
    .register('code128', encodeCode128)
    .register('ean13', encodeEan13);
}
