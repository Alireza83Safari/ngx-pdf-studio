/** Barcode encoders + registry (§5, §12). */
export { encodeCode39, isCode39Encodable } from './code39';
export { BarcodeRegistry, createDefaultBarcodes, type BarcodeEncoder } from './registry';
