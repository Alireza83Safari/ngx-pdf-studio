/* global window */
/**
 * Starter template gallery (§8A-B): ready-made Persian/RTL documents the
 * designer loads with one click. Each entry bundles a valid PdfTemplate plus
 * matching sample data, so the WYSIWYG canvas, preview, and PDF work
 * immediately. Thumbnails are rendered live by the engine in the gallery.
 */
(function () {
  'use strict';

  var V = 'Vazirmatn';
  function rgb(r, g, b) {
    return { space: 'rgb', r: r, g: g, b: b };
  }
  var INK = rgb(15, 23, 42);
  var BLUE = rgb(37, 99, 235);
  var MUTED = rgb(100, 116, 139);

  function page(overrides) {
    return Object.assign(
      {
        size: 'A4',
        orientation: 'portrait',
        margins: { top: 36, right: 36, bottom: 36, left: 36 },
        direction: 'rtl',
        locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
        unit: 'pt',
      },
      overrides || {},
    );
  }
  function text(id, str, x, y, w, h, ty) {
    return {
      id: id,
      type: 'staticText',
      bounds: { x: x, y: y, width: w, height: h },
      zIndex: 1,
      text: str,
      typography: Object.assign({ fontFamily: V, fontSize: 11, color: INK }, ty || {}),
    };
  }
  function fieldEl(id, src, x, y, w, h, ty) {
    return {
      id: id,
      type: 'dataField',
      bounds: { x: x, y: y, width: w, height: h },
      zIndex: 1,
      value: { source: src },
      typography: Object.assign({ fontFamily: V, fontSize: 11, color: INK }, ty || {}),
    };
  }
  function hline(id, x, y, w, color, width) {
    return {
      id: id,
      type: 'line',
      bounds: { x: x, y: y, width: w, height: 2 },
      zIndex: 1,
      stroke: { width: width || 1, color: color || rgb(203, 213, 225) },
    };
  }
  function baseTemplate(name, pageSetup, bands, extra) {
    return Object.assign(
      {
        schemaVersion: '1.0.0',
        metadata: { name: name },
        page: pageSetup,
        styles: [
          {
            id: 'cell',
            name: 'سلول جدول',
            typography: { fontFamily: V, fontSize: 10, color: INK },
          },
          {
            id: 'cellHead',
            name: 'سرستون جدول',
            typography: { fontFamily: V, fontSize: 10, fontWeight: 'bold', color: INK },
            box: { fill: { color: rgb(241, 245, 249) } },
          },
        ],
        datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
        parameters: [],
        bands: bands,
        resources: { fonts: [], images: [] },
      },
      extra || {},
    );
  }

  // --- ۱) فاکتور فروش --------------------------------------------------------
  var invoice = baseTemplate('فاکتور فروش', page(), [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 700 },
      elements: [
        text('t-title', 'فاکتور فروش', 0, 0, 220, 30, {
          fontSize: 22,
          fontWeight: 'bold',
          color: BLUE,
        }),
        fieldEl('f-co', 'company.name', 0, 36, 220, 16, { fontSize: 12, fontWeight: 'bold' }),
        fieldEl('f-addr', 'company.address', 0, 56, 260, 14, { fontSize: 9, color: MUTED }),
        {
          id: 'qr',
          type: 'qrcode',
          bounds: { x: 452, y: 0, width: 70, height: 70 },
          zIndex: 1,
          value: { source: 'invoice.number' },
        },
        text('t-no', 'شمارهٔ فاکتور:', 300, 8, 80, 14, { fontSize: 10, color: MUTED }),
        fieldEl('f-no', 'invoice.number', 300, 24, 130, 16, { fontSize: 11 }),
        text('t-date', 'تاریخ:', 300, 46, 80, 14, { fontSize: 10, color: MUTED }),
        {
          id: 'f-date',
          type: 'pageField',
          field: 'currentDate',
          bounds: { x: 300, y: 62, width: 130, height: 16 },
          zIndex: 1,
          typography: { fontFamily: V, fontSize: 11, color: INK },
        },
        hline('ln1', 0, 92, 523, BLUE, 2),
        text('t-cust', 'خریدار:', 0, 108, 60, 14, { fontSize: 10, color: MUTED }),
        fieldEl('f-cust', 'customer.name', 60, 106, 220, 16, { fontSize: 12, fontWeight: 'bold' }),
        {
          id: 'tbl',
          type: 'table',
          bounds: { x: 0, y: 140, width: 523, height: 120 },
          zIndex: 1,
          dataset: 'items',
          rowStripeStyleId: 'cell',
          columns: [
            {
              id: 'c-name',
              width: { kind: 'percent', value: 46 },
              header: { text: 'شرح کالا', styleId: 'cellHead' },
              detail: { content: { source: 'name' }, styleId: 'cell' },
            },
            {
              id: 'c-qty',
              width: { kind: 'percent', value: 14 },
              header: { text: 'تعداد', styleId: 'cellHead' },
              detail: { content: { source: 'qty' }, styleId: 'cell' },
            },
            {
              id: 'c-price',
              width: { kind: 'percent', value: 20 },
              header: { text: 'فی (ریال)', styleId: 'cellHead' },
              detail: { content: { source: 'price' }, styleId: 'cell' },
            },
            {
              id: 'c-sum',
              width: { kind: 'percent', value: 20 },
              header: { text: 'جمع (ریال)', styleId: 'cellHead' },
              detail: { content: { source: 'qty * price' }, styleId: 'cell' },
              footer: { aggregate: 'sum', styleId: 'cellHead' },
            },
          ],
        },
        text('t-total', 'جمع کل:', 320, 300, 70, 16, { fontSize: 12, fontWeight: 'bold' }),
        fieldEl('f-total', 'sum(items, qty * price)', 390, 300, 133, 18, {
          fontSize: 13,
          fontWeight: 'bold',
          color: BLUE,
        }),
        text(
          't-note',
          'این فاکتور به‌صورت الکترونیکی صادر شده و بدون مهر و امضا معتبر است.',
          0,
          340,
          360,
          14,
          { fontSize: 8, color: MUTED },
        ),
      ],
    },
  ]);
  var invoiceData = {
    company: { name: 'شرکت بازرگانی نمونه', address: 'تهران، خیابان ولیعصر، پلاک ۱۲۳' },
    customer: { name: 'علی رضایی' },
    invoice: { number: 'INV-1405-0042' },
    items: [
      { name: 'لپ‌تاپ ۱۴ اینچ', qty: 1, price: 685000000 },
      { name: 'ماوس بی‌سیم', qty: 2, price: 8900000 },
      { name: 'کیبورد مکانیکی', qty: 1, price: 24500000 },
      { name: 'هاب USB-C', qty: 3, price: 5600000 },
    ],
  };

  // --- ۲) گزارش فروش ----------------------------------------------------------
  var report = baseTemplate('گزارش فروش ماهانه', page(), [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 700 },
      elements: [
        text('t-title', 'گزارش فروش ماهانه', 0, 0, 280, 26, {
          fontSize: 18,
          fontWeight: 'bold',
        }),
        text('t-sub', 'عملکرد شش‌ماههٔ نخست', 0, 30, 220, 14, { fontSize: 10, color: MUTED }),
        hline('ln1', 0, 52, 523, BLUE, 2),
        {
          id: 'chart',
          type: 'chart',
          chartKind: 'column',
          dataset: 'items',
          bounds: { x: 0, y: 70, width: 523, height: 170 },
          zIndex: 1,
          categories: { source: 'month' },
          series: [{ name: 'فروش', values: { source: 'amount' } }],
        },
        {
          id: 'tbl',
          type: 'table',
          bounds: { x: 0, y: 265, width: 523, height: 140 },
          zIndex: 1,
          dataset: 'items',
          columns: [
            {
              id: 'c-month',
              width: { kind: 'percent', value: 40 },
              header: { text: 'ماه', styleId: 'cellHead' },
              detail: { content: { source: 'month' }, styleId: 'cell' },
            },
            {
              id: 'c-amount',
              width: { kind: 'percent', value: 30 },
              header: { text: 'فروش (میلیون ریال)', styleId: 'cellHead' },
              detail: { content: { source: 'amount' }, styleId: 'cell' },
              footer: { aggregate: 'sum', styleId: 'cellHead' },
            },
            {
              id: 'c-target',
              width: { kind: 'percent', value: 30 },
              header: { text: 'هدف', styleId: 'cellHead' },
              detail: { content: { source: 'target' }, styleId: 'cell' },
              footer: { aggregate: 'sum', styleId: 'cellHead' },
            },
          ],
        },
      ],
    },
  ]);
  var reportData = {
    items: [
      { month: 'فروردین', amount: 420, target: 400 },
      { month: 'اردیبهشت', amount: 610, target: 500 },
      { month: 'خرداد', amount: 380, target: 450 },
      { month: 'تیر', amount: 840, target: 700 },
      { month: 'مرداد', amount: 720, target: 700 },
      { month: 'شهریور', amount: 905, target: 800 },
    ],
  };

  // --- ۳) سربرگ نامه ----------------------------------------------------------
  var letterhead = baseTemplate('سربرگ نامه', page(), [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 700 },
      elements: [
        fieldEl('f-co', 'company.name', 0, 0, 260, 24, {
          fontSize: 17,
          fontWeight: 'bold',
          color: BLUE,
        }),
        fieldEl('f-slogan', 'company.slogan', 0, 28, 260, 14, { fontSize: 9, color: MUTED }),
        text('t-no', 'شماره: ............', 400, 4, 120, 14, { fontSize: 10 }),
        text('t-date', 'تاریخ: ............', 400, 24, 120, 14, { fontSize: 10 }),
        text('t-attach', 'پیوست: ............', 400, 44, 120, 14, { fontSize: 10 }),
        hline('ln1', 0, 70, 523, BLUE, 2),
        text('t-sub', 'موضوع: ', 0, 92, 520, 18, { fontSize: 12, fontWeight: 'bold' }),
        text('t-body', 'با سلام و احترام؛\n\nمتن نامه را اینجا بنویسید…', 0, 124, 523, 60, {
          fontSize: 11,
          lineHeight: 1.8,
        }),
        hline('ln2', 0, 660, 523, rgb(203, 213, 225), 1),
        fieldEl('f-foot', 'company.contact', 0, 672, 523, 14, {
          fontSize: 8,
          color: MUTED,
          align: 'center',
        }),
      ],
    },
  ]);
  var letterheadData = {
    company: {
      name: 'شرکت فناوری نوآوران',
      slogan: 'راهکارهای نرم‌افزاری سازمانی',
      contact: 'تهران، خیابان آزادی — تلفن: ۰۲۱-۱۲۳۴۵۶۷۸ — www.example.ir',
    },
  };

  // --- ۴) برچسب محصول ---------------------------------------------------------
  var label = baseTemplate(
    'برچسب محصول',
    page({
      size: { width: 283, height: 170 },
      margins: { top: 12, right: 12, bottom: 12, left: 12 },
    }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 146 },
        elements: [
          fieldEl('f-name', 'product.name', 0, 0, 259, 20, { fontSize: 13, fontWeight: 'bold' }),
          fieldEl('f-price', 'product.price', 0, 26, 160, 26, {
            fontSize: 19,
            fontWeight: 'bold',
            color: BLUE,
          }),
          text('t-unit', 'ریال', 165, 34, 40, 14, { fontSize: 9, color: MUTED }),
          {
            id: 'bc',
            type: 'barcode',
            symbology: 'code128',
            bounds: { x: 0, y: 66, width: 200, height: 56 },
            zIndex: 1,
            value: { source: 'product.sku' },
            showText: true,
          },
          {
            id: 'qr',
            type: 'qrcode',
            bounds: { x: 210, y: 66, width: 49, height: 49 },
            zIndex: 1,
            value: { source: 'product.url' },
          },
        ],
      },
    ],
  );
  var labelData = {
    product: {
      name: 'هدفون بی‌سیم مدل X200',
      price: 12900000,
      sku: 'SKU-88412',
      url: 'https://example.ir/p/88412',
    },
  };

  // --- ۵) گواهی ---------------------------------------------------------------
  var certificate = baseTemplate('گواهی‌نامه', page({ orientation: 'landscape' }), [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 480 },
      elements: [
        {
          id: 'frame',
          type: 'rectangle',
          bounds: { x: 0, y: 0, width: 770, height: 470 },
          zIndex: 1,
          box: { border: { all: { width: 3, color: BLUE } } },
        },
        {
          id: 'frame2',
          type: 'rectangle',
          bounds: { x: 8, y: 8, width: 754, height: 454 },
          zIndex: 1,
          box: { border: { all: { width: 1, color: rgb(148, 163, 184) } } },
        },
        text('t-title', 'گواهی‌نامهٔ پایان دوره', 135, 60, 500, 34, {
          fontSize: 26,
          fontWeight: 'bold',
          color: BLUE,
          align: 'center',
        }),
        text('t-lead', 'بدین‌وسیله گواهی می‌شود', 135, 130, 500, 18, {
          fontSize: 12,
          color: MUTED,
          align: 'center',
        }),
        fieldEl('f-name', 'person.name', 135, 160, 500, 30, {
          fontSize: 22,
          fontWeight: 'bold',
          align: 'center',
        }),
        fieldEl(
          'f-course',
          "'دورهٔ «' + course.title + '» را با موفقیت به پایان رسانده است.'",
          85,
          210,
          600,
          20,
          {
            fontSize: 13,
            align: 'center',
          },
        ),
        text('t-sig1', 'مدیر آموزش', 120, 380, 140, 16, { fontSize: 11, align: 'center' }),
        hline('sig1', 110, 372, 160, rgb(148, 163, 184), 1),
        text('t-sig2', 'مدرس دوره', 510, 380, 140, 16, { fontSize: 11, align: 'center' }),
        hline('sig2', 500, 372, 160, rgb(148, 163, 184), 1),
        {
          id: 'qr',
          type: 'qrcode',
          bounds: { x: 355, y: 360, width: 60, height: 60 },
          zIndex: 1,
          value: { source: 'verifyUrl' },
        },
      ],
    },
  ]);
  var certificateData = {
    person: { name: 'سارا محمدی' },
    course: { title: 'برنامه‌نویسی TypeScript پیشرفته' },
    verifyUrl: 'https://example.ir/verify/CERT-1405-118',
  };

  window.PDFSTUDIO_TEMPLATES = [
    {
      id: 'invoice',
      name: 'فاکتور فروش',
      desc: 'جدول اقلام + جمع کل + QR',
      template: invoice,
      data: invoiceData,
    },
    {
      id: 'report',
      name: 'گزارش فروش',
      desc: 'چارت ستونی + جدول با جمع',
      template: report,
      data: reportData,
    },
    {
      id: 'letterhead',
      name: 'سربرگ نامه',
      desc: 'سربرگ اداری با شماره/تاریخ',
      template: letterhead,
      data: letterheadData,
    },
    {
      id: 'label',
      name: 'برچسب محصول',
      desc: 'بارکد + قیمت + QR (سایز کوچک)',
      template: label,
      data: labelData,
    },
    {
      id: 'certificate',
      name: 'گواهی‌نامه',
      desc: 'افقی با قاب و امضا',
      template: certificate,
      data: certificateData,
    },
  ];
})();
