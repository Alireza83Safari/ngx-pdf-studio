/**
 * Feature-showcase demo: renders one PDF + HTML preview exercising the newer
 * engine features — chart, Code128 barcode with human-readable text, QR,
 * data bars, icon sets, rotation, hyperlinks, bookmarks, a fillable form
 * field, and a custom registered element (gauge). Run with:
 *   npm run build:core && node apps/playground/showcase.js
 */
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const {
  loadBundledVazirmatn,
  VAZIRMATN_FAMILY,
} = require('../../packages/pdf-studio/core/dist/node/index.js');
const {
  renderToPdf,
  renderToSvg,
  ElementRegistry,
} = require('../../packages/pdf-studio/core/dist/index.js');

const fa = { language: 'fa', digits: 'persian', calendar: 'jalali' };
const F = { fontFamily: VAZIRMATN_FAMILY };

const label = (id, text, x, y, extra = {}) => ({
  id,
  type: 'staticText',
  bounds: { x, y, width: 240, height: 14 },
  zIndex: 1,
  text,
  typography: { ...F, fontSize: 9, color: { space: 'rgb', r: 110, g: 110, b: 110 } },
  ...extra,
});

const template = {
  schemaVersion: '1.0.0',
  metadata: { name: 'showcase' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
    direction: 'rtl',
    locale: fa,
    unit: 'pt',
  },
  styles: [{ id: 'faCell', typography: { ...F, fontSize: 10 } }],
  datasets: [{ name: 'sales', source: { kind: 'path', path: 'sales' } }],
  parameters: [],
  variables: [{ name: 'total', expression: { source: 'amount' }, calculation: 'sum' }],
  bands: [
    {
      id: 'head',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 640 },
      elements: [
        {
          id: 'title',
          type: 'staticText',
          bounds: { x: 0, y: 0, width: 520, height: 28 },
          zIndex: 1,
          text: 'ویترین قابلیت‌ها — ngx-pdf-studio',
          typography: { ...F, fontSize: 20 },
          bookmark: { level: 0 },
        },
        label('l1', 'چارت ستونی برداری (هر دو painter):', 0, 44),
        {
          id: 'chart',
          type: 'chart',
          chartKind: 'column',
          dataset: 'sales',
          bounds: { x: 0, y: 60, width: 250, height: 110 },
          zIndex: 1,
          categories: { source: 'month' },
          series: [{ name: 'فروش', values: { source: 'amount' } }],
          bookmark: { level: 1, title: { source: "'چارت'" } },
        },
        label('l2', 'گِیج سفارشی (Element Registry §12):', 270, 44),
        {
          id: 'gauge',
          type: 'custom',
          renderer: 'gauge',
          value: { source: '72' },
          options: { max: 100 },
          bounds: { x: 270, y: 62, width: 220, height: 18 },
          zIndex: 1,
        },
        label('l3', 'دیتابار + آیکن‌ست (conditional formatting):', 270, 96),
        {
          id: 'db',
          type: 'dataField',
          bounds: { x: 270, y: 112, width: 220, height: 16 },
          zIndex: 1,
          value: { source: '65' },
          typography: { ...F, fontSize: 10 },
          dataBar: {
            value: { source: '65' },
            max: 100,
            color: { space: 'rgb', r: 180, g: 214, b: 255 },
          },
          iconSet: {
            value: { source: '65' },
            thresholds: [
              { at: 0, icon: 'triangleDown', color: { space: 'rgb', r: 200, g: 30, b: 30 } },
              { at: 50, icon: 'circle', color: { space: 'rgb', r: 230, g: 160, b: 0 } },
              { at: 80, icon: 'triangleUp', color: { space: 'rgb', r: 20, g: 150, b: 60 } },
            ],
          },
        },
        label('l4', 'بارکد Code128 با متن خوانا:', 0, 190),
        {
          id: 'bc',
          type: 'barcode',
          symbology: 'code128',
          bounds: { x: 0, y: 206, width: 200, height: 54 },
          zIndex: 1,
          value: { source: "'NGX-2026'" },
          showText: true,
          bookmark: { level: 1, title: { source: "'بارکد'" } },
        },
        label('l5', 'QR (اسکن‌پذیر):', 230, 190),
        {
          id: 'qr',
          type: 'qrcode',
          bounds: { x: 230, y: 206, width: 60, height: 60 },
          zIndex: 1,
          value: { source: "'https://github.com/ngx-pdf-studio'" },
        },
        label('l6', 'چرخش ۹۰ درجه:', 320, 190),
        {
          id: 'rot',
          type: 'staticText',
          bounds: { x: 340, y: 206, width: 90, height: 14 },
          zIndex: 1,
          rotation: 90,
          text: 'چرخیده!',
          typography: { ...F, fontSize: 11 },
        },
        label('l7', 'لینک خارجی کلیک‌پذیر:', 0, 286),
        {
          id: 'lnk',
          type: 'staticText',
          bounds: { x: 0, y: 302, width: 200, height: 16 },
          zIndex: 1,
          text: 'example.com ↗',
          typography: { ...F, fontSize: 11, color: { space: 'rgb', r: 20, g: 90, b: 200 } },
          link: { kind: 'url', target: { source: "'https://example.com'" } },
        },
        label('l8', 'فیلد فرم پرشدنی (AcroForm):', 230, 286),
        {
          id: 'ff',
          type: 'formField',
          fieldKind: 'text',
          fieldName: 'customerName',
          defaultValue: { source: "'نام مشتری…'" },
          bounds: { x: 230, y: 302, width: 180, height: 20 },
          zIndex: 1,
        },
        label('l9', 'جدول با aggregate + راست‌به‌چپ:', 0, 350),
        {
          id: 'tbl',
          type: 'table',
          bounds: { x: 0, y: 366, width: 420, height: 80 },
          zIndex: 1,
          dataset: 'sales',
          columns: [
            {
              id: 'c0',
              width: { kind: 'percent', value: 50 },
              header: { text: 'ماه', styleId: 'faCell' },
              detail: { content: { source: 'month' }, styleId: 'faCell' },
            },
            {
              id: 'c1',
              width: { kind: 'percent', value: 50 },
              header: { text: 'مبلغ', styleId: 'faCell' },
              detail: { content: { source: 'amount' }, styleId: 'faCell' },
              footer: { aggregate: 'sum', styleId: 'faCell' },
            },
          ],
          bookmark: { level: 1, title: { source: "'جدول'" } },
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};

const data = {
  sales: [
    { month: 'فروردین', amount: 4200 },
    { month: 'اردیبهشت', amount: 6100 },
    { month: 'خرداد', amount: 3800 },
    { month: 'تیر', amount: 8400 },
  ],
};

const gauge = ({ value, options, width, height }) => {
  const frac = Math.max(0, Math.min(1, Number(value) / Number(options.max ?? 100)));
  return [
    { op: 'rect', x: 0, y: 0, w: width, h: height, fill: { r: 0.92, g: 0.92, b: 0.94 } },
    { op: 'rect', x: 0, y: 0, w: width * frac, h: height, fill: { r: 0.13, g: 0.55, b: 0.45 } },
    {
      op: 'line',
      x1: 0,
      y1: height,
      x2: width,
      y2: height,
      color: { r: 0.3, g: 0.3, b: 0.3 },
      width: 0.8,
    },
  ];
};

(async () => {
  const registry = new ElementRegistry().register('gauge', gauge);
  const options = {
    paginate: { elements: registry },
    pdf: { fonts: loadBundledVazirmatn(), metadata: { title: 'ngx-pdf-studio showcase' } },
  };
  const out = join(__dirname, 'output');
  mkdirSync(out, { recursive: true });

  const pdf = await renderToPdf(template, { data }, options);
  writeFileSync(join(out, 'showcase.pdf'), pdf.bytes);

  const svg = renderToSvg(template, { data }, options);
  const html = `<!doctype html><meta charset="utf-8"><title>showcase</title>
<body style="background:#666;display:flex;flex-direction:column;align-items:center;gap:16px;padding:16px">
${svg.pages.map((p) => `<div style="background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.4)">${p}</div>`).join('')}
</body>`;
  writeFileSync(join(out, 'showcase.html'), html);

  console.log('pages:', pdf.pageCount, '| diagnostics:', pdf.diagnostics.length);
  for (const d of pdf.diagnostics) console.log('  -', d.message);
  console.log('open:', join(out, 'showcase.pdf'));
  console.log('open:', join(out, 'showcase.html'));
})();
