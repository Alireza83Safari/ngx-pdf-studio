/**
 * Format Cloner (Moonshot F2), step 2.6 — end-to-end round-trip on a real
 * rendered invoice. We render a bound invoice to an actual PDF, extract it back
 * through pdfjs (the same path the designer's "Clone Format" uses), clone it,
 * and assert the clone recovered the header fields + the item table and that
 * re-rendering the clone reproduces the original values ("import → render
 * resembles the source").
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { renderToPdf, renderToSvg } from '../render';
import { cloneFormat } from './clone';
import { extractPdfContent } from './extract';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const label = (id: string, text: string, x: number, y: number): AnyElement =>
  ({
    id,
    type: 'staticText',
    bounds: { x, y, width: 90, height: 16 },
    zIndex: 1,
    text,
    typography: { fontSize: 11, align: 'start' },
  }) as AnyElement;

const value = (id: string, source: string, x: number, y: number): AnyElement =>
  ({
    id,
    type: 'dataField',
    bounds: { x, y, width: 160, height: 16 },
    zIndex: 1,
    value: { source },
    typography: { fontSize: 11, align: 'start' },
  }) as AnyElement;

const DATA = {
  invoice: { number: 'INV-1024', date: '2024-05-01' },
  items: [
    { name: 'Widget', qty: '2', price: '1,000' },
    { name: 'Gadget', qty: '5', price: '2,000' },
    { name: 'Sprocket', qty: '1', price: '500' },
  ],
};

const invoiceTemplate: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'Invoice' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 40, right: 40, bottom: 40, left: 40 },
    direction: 'ltr',
    locale: EN,
    unit: 'pt',
  },
  styles: [],
  datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
  parameters: [],
  bands: [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 300 },
      elements: [
        label('l-no', 'Invoice No:', 0, 0),
        value('v-no', 'invoice.number', 100, 0),
        label('l-date', 'Date:', 0, 24),
        value('v-date', 'invoice.date', 100, 24),
        {
          id: 'tbl',
          type: 'table',
          bounds: { x: 0, y: 60, width: 515, height: 120 },
          zIndex: 1,
          dataset: 'items',
          columns: [
            {
              id: 'c-name',
              width: { kind: 'percent', value: 50 },
              header: { text: 'Item' },
              detail: { content: { source: 'name' } },
            },
            {
              id: 'c-qty',
              width: { kind: 'percent', value: 20 },
              header: { text: 'Qty' },
              detail: { content: { source: 'qty' } },
            },
            {
              id: 'c-price',
              width: { kind: 'percent', value: 30 },
              header: { text: 'Price' },
              detail: { content: { source: 'price' } },
            },
          ],
        } as AnyElement,
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

describe('F2.6 clone round-trip on a rendered invoice', () => {
  it('recovers header fields + the item table and re-renders the values', async () => {
    // render → real PDF → extract back through pdfjs (the designer's path)
    const { bytes } = await renderToPdf(invoiceTemplate, { data: DATA });
    const doc = await getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false })
      .promise;
    const pages = await extractPdfContent(doc);
    expect(pages.length).toBeGreaterThan(0);

    const result = await cloneFormat(pages, { name: 'Cloned invoice' });

    // header labels became bound fields
    const paths = result.schema.fields.map((f) => f.path);
    expect(paths).toContain('invoice_no');
    expect(paths).toContain('date');
    expect(result.schema.fields.length).toBeGreaterThanOrEqual(2);
    expect(result.inferredData['invoice_no']).toBe('INV-1024');

    // the item lines became one bound table with 3 columns and 3 rows
    expect(result.schema.tables).toHaveLength(1);
    expect(result.schema.tables[0]!.columns).toHaveLength(3);
    const items = result.inferredData['items'] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(Object.keys(items[0]!)).toHaveLength(3);

    // re-rendering the clone reproduces the source values (resembles original)
    const svg = renderToSvg(result.template, { data: result.inferredData }).pages.join('');
    expect(svg).toContain('INV-1024');
    expect(svg).toContain('2024-05-01');
    expect(svg).toContain('Widget');
    expect(svg).toContain('Sprocket');
  });
});
