/**
 * A representative, bilingual sample template used across tests. Typing it as
 * {@link PdfTemplate} is itself a compile-time conformance check that the model
 * is usable to author a real document. It exercises: a repeating page
 * header/footer, a Persian RTL block, an English LTR block, a detail table bound
 * to `items[]`, a Jalali date field, and Persian-digit formatting (§11).
 */
import { CURRENT_SCHEMA_VERSION, type PdfTemplate } from '../template';

export const sampleTemplate: PdfTemplate = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  metadata: {
    name: 'Bilingual Invoice / فاکتور دوزبانه',
    author: 'ngx-pdf-studio',
    description: 'Mixed Persian (RTL) + English (LTR) invoice sample.',
    createdAt: '2026-06-24T00:00:00.000Z',
    tags: ['invoice', 'rtl', 'persian'],
  },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
    direction: 'rtl',
    locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
    unit: 'pt',
  },
  styles: [
    {
      id: 'title',
      name: 'Title',
      typography: { fontFamily: 'Vazirmatn', fontSize: 18, fontWeight: 'bold', align: 'center' },
    },
    {
      id: 'th',
      name: 'Table header',
      typography: { fontWeight: 'bold' },
      box: { fill: { color: { space: 'rgb', r: 240, g: 240, b: 240 } } },
    },
  ],
  datasets: [
    {
      name: 'items',
      source: { kind: 'path', path: 'items' },
      shape: [
        { path: 'name', type: 'string', label: 'Name / نام' },
        { path: 'qty', type: 'number' },
        { path: 'price', type: 'number' },
      ],
    },
  ],
  parameters: [{ name: 'title', type: 'string', label: 'Document title', required: true }],
  bands: [
    {
      id: 'page-header',
      type: 'pageHeader',
      height: { mode: 'fixed', value: 64 },
      elements: [
        {
          id: 'doc-title',
          type: 'dataField',
          bounds: { x: 0, y: 0, width: 523, height: 28 },
          zIndex: 1,
          styleId: 'title',
          value: { source: 'parameters.title' },
        },
        {
          id: 'warehouse-name',
          type: 'dataField',
          bounds: { x: 0, y: 32, width: 261, height: 20 },
          zIndex: 1,
          direction: 'rtl',
          value: { source: 'anbar.name' },
          fallback: '—',
        },
        {
          id: 'issued-on',
          type: 'dataField',
          bounds: { x: 300, y: 32, width: 223, height: 20 },
          zIndex: 1,
          direction: 'ltr',
          locale: { language: 'en', digits: 'latn', calendar: 'gregorian' },
          value: { source: 'now()' },
          format: { kind: 'date', options: { pattern: 'yyyy-MM-dd' } },
        },
      ],
    },
    {
      id: 'detail',
      type: 'detail',
      height: { mode: 'auto', min: 24 },
      dataset: 'items',
      canSplit: true,
      elements: [
        {
          id: 'items-table',
          type: 'table',
          bounds: { x: 0, y: 0, width: 523, height: 24 },
          zIndex: 1,
          dataset: 'items',
          repeatHeader: true,
          columns: [
            {
              id: 'name',
              width: { kind: 'percent', value: 60 },
              header: { text: 'نام کالا' },
              detail: { content: { source: 'name' } },
            },
            {
              id: 'qty',
              width: { kind: 'percent', value: 20 },
              header: { text: 'تعداد' },
              detail: { content: { source: 'qty' } },
              footer: { aggregate: 'sum' },
            },
            {
              id: 'price',
              width: { kind: 'percent', value: 20 },
              header: { text: 'قیمت' },
              detail: { content: { source: 'price' } },
              footer: { aggregate: 'sum' },
            },
          ],
        },
      ],
    },
    {
      id: 'page-footer',
      type: 'pageFooter',
      height: { mode: 'fixed', value: 24 },
      elements: [
        {
          id: 'page-no',
          type: 'pageField',
          bounds: { x: 0, y: 0, width: 523, height: 16 },
          zIndex: 1,
          field: 'page',
          format: { kind: 'number', locale: { digits: 'persian' } },
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};
