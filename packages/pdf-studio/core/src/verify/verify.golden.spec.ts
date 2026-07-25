/**
 * F1.6 — determinism, tamper-evidence, and golden vectors for Verifiable
 * Documents. These lock the exact hash bytes for a fixed (template, data) so
 * any accidental change to canonicalization or hashing is caught, and prove the
 * end-to-end story: same input → same code (Node=Browser by construction, since
 * sha256Hex is pure JS over manual UTF-8), and changing *any* bound value moves
 * both the hash and the printed short code.
 */
import type { PdfTemplate } from '../model/template';
import { renderToSvg } from '../render';
import { hashDocument, verifyDocument } from './verify';
import { stampVerification } from './stamp';

/** A realistic RTL invoice with header fields + a bound line-item table. */
function invoice(): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'فاکتور فروش' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      direction: 'rtl',
      locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands: [
      {
        id: 'header',
        type: 'pageHeader',
        height: { mode: 'fixed', value: 60 },
        elements: [
          {
            id: 'title',
            type: 'staticText',
            bounds: { x: 0, y: 0, width: 300, height: 20 },
            zIndex: 1,
            text: 'فاکتور فروش',
          },
          {
            id: 'num',
            type: 'dataField',
            bounds: { x: 320, y: 0, width: 200, height: 16 },
            zIndex: 1,
            value: { source: 'invoice.number' },
          },
        ],
      },
      {
        id: 'items',
        type: 'detail',
        dataset: 'items',
        height: { mode: 'auto' },
        elements: [
          {
            id: 'name',
            type: 'dataField',
            bounds: { x: 0, y: 0, width: 200, height: 16 },
            zIndex: 1,
            value: { source: 'name' },
          },
          {
            id: 'price',
            type: 'dataField',
            bounds: { x: 220, y: 0, width: 120, height: 16 },
            zIndex: 1,
            value: { source: 'price' },
          },
        ],
      },
    ],
    resources: { fonts: [], images: [] },
  } as unknown as PdfTemplate;
}

const DATA = {
  invoice: { number: 'INV-1024', issuedAt: '1403-05-01' },
  customer: { name: 'شرکت نمونه' },
  items: [
    { name: 'لپ‌تاپ', price: 42000000 },
    { name: 'ماوس', price: 850000 },
  ],
};

describe('F1.6 golden vectors', () => {
  // Locked hash for `invoice()` + `DATA`. sha256Hex is pure JS over manual
  // UTF-8 bytes, so this value is identical on Node and in the browser — that
  // identity is exactly what makes a printed code verifiable anywhere. If this
  // breaks, the hashing surface changed and every previously issued code is
  // invalidated: bump VERIFY_VERSION intentionally rather than editing the digit.
  const GOLDEN_HASH = '8f2ed0836e7e3fddda10d371264f54a417f4fb14bd7fc09fe888d541f72c6535';

  it('produces the locked golden hash for the fixed invoice', () => {
    const { hash, short } = hashDocument(invoice(), { data: DATA });
    expect(hash).toBe(GOLDEN_HASH);
    expect(short).toBe(GOLDEN_HASH.slice(0, 10));
  });
});

describe('F1.6 determinism', () => {
  it('is bit-stable across many recomputations', () => {
    const first = hashDocument(invoice(), { data: DATA }).hash;
    for (let i = 0; i < 50; i++) {
      expect(hashDocument(invoice(), { data: DATA }).hash).toBe(first);
    }
  });

  it('ignores key insertion order at every depth', () => {
    const reordered = {
      items: [
        { price: 42000000, name: 'لپ‌تاپ' },
        { price: 850000, name: 'ماوس' },
      ],
      customer: { name: 'شرکت نمونه' },
      invoice: { issuedAt: '1403-05-01', number: 'INV-1024' },
    };
    expect(hashDocument(invoice(), { data: reordered }).hash).toBe(
      hashDocument(invoice(), { data: DATA }).hash,
    );
  });
});

describe('F1.6 tamper-evidence', () => {
  const base = hashDocument(invoice(), { data: DATA }).hash;

  // Every bound value that appears on the page must move the hash when changed.
  const mutations: Array<[string, typeof DATA]> = [
    ['header field', { ...DATA, invoice: { ...DATA.invoice, number: 'INV-1025' } }],
    ['first row price', { ...DATA, items: [{ ...DATA.items[0]!, price: 42000001 }, DATA.items[1]!] }],
    ['first row name', { ...DATA, items: [{ ...DATA.items[0]!, name: 'لپ‌تاپِ گیمینگ' }, DATA.items[1]!] }],
    ['row count', { ...DATA, items: [...DATA.items, { name: 'کیبورد', price: 1200000 }] }],
    ['row order', { ...DATA, items: [DATA.items[1]!, DATA.items[0]!] }],
  ];

  it.each(mutations)('changing the %s changes the hash', (_label, mutated) => {
    expect(hashDocument(invoice(), { data: mutated }).hash).not.toBe(base);
  });

  it('the printed short code tracks the data through the stamp', () => {
    const good = hashDocument(invoice(), { data: DATA }).short;
    const stamped = stampVerification(invoice(), { data: DATA });
    const svg = renderToSvg(stamped, { data: DATA }).pages.join('');
    expect(svg).toContain(good);

    // a tampered render carries a different code
    const tampered = { ...DATA, invoice: { ...DATA.invoice, number: 'INV-9999' } };
    const badCode = hashDocument(invoice(), { data: tampered }).short;
    expect(badCode).not.toBe(good);
    const tamperedSvg = renderToSvg(stampVerification(invoice(), { data: tampered }), {
      data: tampered,
    }).pages.join('');
    expect(tamperedSvg).toContain(badCode);
    expect(tamperedSvg).not.toContain(good);
  });
});

describe('F1.6 verify round-trip', () => {
  it('accepts the genuine document and rejects every tamper', () => {
    const { hash, short } = hashDocument(invoice(), { data: DATA });
    expect(verifyDocument(invoice(), { data: DATA }, hash)).toBe(true);
    expect(verifyDocument(invoice(), { data: DATA }, short)).toBe(true);

    const tampered = { ...DATA, customer: { name: 'مهاجم' } };
    expect(verifyDocument(invoice(), { data: tampered }, hash)).toBe(false);
    expect(verifyDocument(invoice(), { data: tampered }, short)).toBe(false);
  });
});
