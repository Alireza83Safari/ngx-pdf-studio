import type { PdfTemplate } from '../model/template';
import { canonicalize } from './canonical';
import { sha256Hex } from './sha256';
import { hashDocument, verifyDocument, VERIFY_VERSION } from './verify';

describe('sha256Hex', () => {
  it('matches known NIST test vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });

  it('encodes multi-byte UTF-8 (Persian) deterministically', () => {
    // sha256 of the UTF-8 bytes of "سلام" — a stable value across platforms
    const a = sha256Hex('سلام');
    const b = sha256Hex('سلام');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).not.toBe(sha256Hex('سلاك'));
  });
});

describe('canonicalize', () => {
  it('is independent of object key insertion order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(canonicalize({ x: { p: 1, q: 2 } })).toBe(canonicalize({ x: { q: 2, p: 1 } }));
  });

  it('preserves array order and drops undefined members', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('hashDocument', () => {
  const template = { schemaVersion: 1, page: { size: 'A4' }, bands: [] } as unknown as PdfTemplate;

  it('is stable for equal inputs and exposes a short code', () => {
    const h1 = hashDocument(template, { data: { total: 100 } });
    const h2 = hashDocument(template, { data: { total: 100 } });
    expect(h1.hash).toBe(h2.hash);
    expect(h1.hash).toHaveLength(64);
    expect(h1.short).toBe(h1.hash.slice(0, 10));
  });

  it('changes when any bound value changes (tamper-evident)', () => {
    const base = hashDocument(template, { data: { total: 100 } }).hash;
    expect(hashDocument(template, { data: { total: 101 } }).hash).not.toBe(base);
    expect(hashDocument(template, { data: { total: 100 }, now: 1 }).hash).not.toBe(base);
    expect(hashDocument(template, { data: { total: 100 }, parameters: { x: 1 } }).hash).not.toBe(
      base,
    );
  });

  it('is insensitive to data key order (same document, same hash)', () => {
    const a = hashDocument(template, { data: { a: 1, b: 2 } }).hash;
    const b = hashDocument(template, { data: { b: 2, a: 1 } }).hash;
    expect(a).toBe(b);
  });

  it('participates in the versioned scheme', () => {
    expect(VERIFY_VERSION).toBe(1);
  });
});

describe('verifyDocument', () => {
  const template = { schemaVersion: 1, page: { size: 'A4' }, bands: [] } as unknown as PdfTemplate;
  const input = { data: { total: 100 } };

  it('accepts the full hash and the short code, rejects tampered data', () => {
    const { hash, short } = hashDocument(template, input);
    expect(verifyDocument(template, input, hash)).toBe(true);
    expect(verifyDocument(template, input, '  ' + hash.toUpperCase() + ' ')).toBe(true);
    expect(verifyDocument(template, input, short)).toBe(true);
    expect(verifyDocument(template, { data: { total: 999 } }, hash)).toBe(false);
  });
});
