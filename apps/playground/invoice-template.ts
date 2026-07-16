/**
 * A ready-made bilingual (Persian RTL) invoice template for the playground
 * demo — the kind of starter the gallery (§8A-B) will eventually offer. Built
 * with the framework-agnostic model so it round-trips to/from template JSON.
 */
import type { AnyElement, Band, PdfTemplate } from '../../packages/pdf-studio/core/src';

const FONT = 'Vazirmatn';
const ACCENT = { space: 'rgb', r: 37, g: 99, b: 235 } as const;
const MUTED = { space: 'rgb', r: 100, g: 116, b: 139 } as const;
const HEADER_FILL = { space: 'rgb', r: 241, g: 245, b: 249 } as const;
const LINE = { space: 'rgb', r: 203, g: 213, b: 225 } as const;

const text = (
  id: string,
  value: string,
  bounds: AnyElement['bounds'],
  extra: Partial<AnyElement> = {},
): AnyElement =>
  ({
    id,
    type: 'staticText',
    bounds,
    zIndex: 1,
    text: value,
    typography: { fontFamily: FONT, fontSize: 11 },
    ...extra,
  }) as AnyElement;

const field = (
  id: string,
  source: string,
  bounds: AnyElement['bounds'],
  extra: Partial<AnyElement> = {},
): AnyElement =>
  ({
    id,
    type: 'dataField',
    bounds,
    zIndex: 1,
    value: { source },
    typography: { fontFamily: FONT, fontSize: 11 },
    ...extra,
  }) as AnyElement;

const header: Band = {
  id: 'header',
  type: 'reportHeader',
  height: { mode: 'fixed', value: 220 },
  elements: [
    text(
      'title',
      'فاکتور فروش',
      { x: 0, y: 0, width: 535, height: 30 },
      {
        typography: {
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 'bold',
          color: ACCENT,
          align: 'start',
        },
      },
    ),
    field(
      'company',
      'company.name',
      { x: 0, y: 34, width: 300, height: 18 },
      {
        typography: { fontFamily: FONT, fontSize: 12 },
      },
    ),
    text(
      'invoiceNoLabel',
      'شماره فاکتور:',
      { x: 320, y: 34, width: 110, height: 16 },
      {
        typography: { fontFamily: FONT, fontSize: 10, color: MUTED, align: 'end' },
      },
    ),
    field(
      'invoiceNo',
      'invoice.number',
      { x: 435, y: 34, width: 100, height: 16 },
      {
        typography: { fontFamily: FONT, fontSize: 11, align: 'end' },
      },
    ),
    text(
      'dateLabel',
      'تاریخ:',
      { x: 320, y: 54, width: 110, height: 16 },
      {
        typography: { fontFamily: FONT, fontSize: 10, color: MUTED, align: 'end' },
      },
    ),
    field(
      'date',
      'now()',
      { x: 435, y: 54, width: 100, height: 16 },
      {
        typography: { fontFamily: FONT, fontSize: 11, align: 'end' },
        format: { kind: 'date', options: { pattern: 'yyyy/MM/dd' } },
      },
    ),
    field(
      'customer',
      "concat('مشتری: ', customer.name)",
      { x: 0, y: 64, width: 300, height: 18 },
      {
        typography: { fontFamily: FONT, fontSize: 11 },
      },
    ),
    {
      id: 'items',
      type: 'table',
      bounds: { x: 0, y: 100, width: 535, height: 24 },
      zIndex: 1,
      dataset: 'items',
      border: { width: 0.5, color: LINE },
      rowStripeStyleId: 'stripe',
      columns: [
        {
          id: 'name',
          width: { kind: 'auto' },
          header: { text: 'شرح کالا', styleId: 'th' },
          detail: { content: { source: 'name' }, styleId: 'cell' },
          footer: { text: 'جمع کل', styleId: 'th' },
        },
        {
          id: 'qty',
          width: { kind: 'fixed', value: 70 },
          header: { text: 'تعداد', styleId: 'th' },
          detail: { content: { source: 'qty' }, styleId: 'cell' },
        },
        {
          id: 'price',
          width: { kind: 'fixed', value: 110 },
          header: { text: 'قیمت واحد', styleId: 'th' },
          detail: { content: { source: 'price' }, styleId: 'cell' },
        },
        {
          id: 'total',
          width: { kind: 'fixed', value: 120 },
          header: { text: 'مبلغ', styleId: 'th' },
          detail: { content: { source: 'qty * price' }, styleId: 'cell' },
          footer: { aggregate: 'sum', styleId: 'th' },
        },
      ],
    },
  ],
};

const footer: Band = {
  id: 'footer',
  type: 'pageFooter',
  height: { mode: 'fixed', value: 24 },
  elements: [
    {
      id: 'pageNo',
      type: 'pageField',
      field: 'page',
      bounds: { x: 0, y: 6, width: 535, height: 14 },
      zIndex: 1,
      typography: { fontFamily: FONT, fontSize: 9, color: MUTED, align: 'center' },
      format: { kind: 'number', locale: { digits: 'persian' } },
    },
  ],
};

export const invoiceTemplate: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'Persian invoice / فاکتور فارسی', author: 'ngx-pdf-studio playground' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 30, right: 30, bottom: 30, left: 30 },
    direction: 'rtl',
    locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
    unit: 'pt',
  },
  styles: [
    {
      id: 'th',
      name: 'Table header',
      typography: { fontFamily: FONT, fontSize: 11, fontWeight: 'bold' },
      box: { fill: { color: HEADER_FILL } },
    },
    { id: 'cell', name: 'Cell', typography: { fontFamily: FONT, fontSize: 11 } },
    {
      id: 'stripe',
      name: 'Row stripe',
      box: { fill: { color: { space: 'rgb', r: 248, g: 250, b: 252 } } },
    },
  ],
  datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
  parameters: [],
  bands: [header, footer],
  resources: { fonts: [], images: [] },
};

export const sampleData = {
  company: { name: 'شرکت نمونه پارس' },
  customer: { name: 'علی رضایی' },
  invoice: { number: 'INV-1405-0042' },
  items: [
    { name: 'کاغذ A4 (بسته ۵۰۰ برگ)', qty: 12, price: 185000 },
    { name: 'خودکار آبی', qty: 50, price: 12000 },
    { name: 'پوشه فایل', qty: 30, price: 25000 },
    { name: 'ماژیک وایت‌برد', qty: 8, price: 38000 },
  ],
};
