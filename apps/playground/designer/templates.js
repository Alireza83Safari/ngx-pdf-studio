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

  // --- ۶) رسید پرداخت (عرض ۸ سانتی، حرارتی) --------------------------------
  var receipt = baseTemplate(
    'رسید پرداخت',
    page({
      size: { width: 226, height: 430 },
      margins: { top: 16, right: 14, bottom: 16, left: 14 },
    }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 398 },
        elements: [
          fieldEl('r-store', 'store.name', 0, 0, 198, 18, {
            fontSize: 13,
            fontWeight: 'bold',
            align: 'center',
          }),
          fieldEl('r-branch', 'store.branch', 0, 22, 198, 12, {
            fontSize: 8,
            color: MUTED,
            align: 'center',
          }),
          hline('r-ln1', 0, 44, 198),
          text('r-no-l', 'شمارهٔ رسید', 0, 56, 90, 12, { fontSize: 9, color: MUTED }),
          fieldEl('r-no', 'receipt.number', 98, 56, 100, 12, { fontSize: 9, align: 'end' }),
          text('r-date-l', 'تاریخ', 0, 74, 90, 12, { fontSize: 9, color: MUTED }),
          {
            id: 'r-date',
            type: 'pageField',
            field: 'currentDate',
            bounds: { x: 98, y: 74, width: 100, height: 12 },
            zIndex: 1,
            typography: { fontFamily: V, fontSize: 9, align: 'end', color: INK },
          },
          text('r-for-l', 'بابت', 0, 92, 90, 12, { fontSize: 9, color: MUTED }),
          fieldEl('r-for', 'receipt.description', 60, 92, 138, 12, { fontSize: 9, align: 'end' }),
          hline('r-ln2', 0, 114, 198),
          text('r-amt-l', 'مبلغ پرداخت‌شده', 0, 128, 198, 14, {
            fontSize: 9,
            color: MUTED,
            align: 'center',
          }),
          fieldEl('r-amt', 'receipt.amount', 0, 146, 198, 26, {
            fontSize: 20,
            fontWeight: 'bold',
            align: 'center',
            color: BLUE,
          }),
          text('r-unit', 'ریال', 0, 176, 198, 12, { fontSize: 8, color: MUTED, align: 'center' }),
          hline('r-ln3', 0, 200, 198),
          text('r-pay-l', 'روش پرداخت', 0, 212, 90, 12, { fontSize: 9, color: MUTED }),
          fieldEl('r-pay', 'receipt.method', 98, 212, 100, 12, { fontSize: 9, align: 'end' }),
          text('r-ref-l', 'کد پیگیری', 0, 230, 90, 12, { fontSize: 9, color: MUTED }),
          fieldEl('r-ref', 'receipt.ref', 98, 230, 100, 12, { fontSize: 9, align: 'end' }),
          {
            id: 'r-qr',
            type: 'qrcode',
            bounds: { x: 69, y: 262, width: 60, height: 60 },
            zIndex: 1,
            value: { source: 'receipt.ref' },
          },
          text('r-thanks', 'از خرید شما سپاسگزاریم', 0, 336, 198, 14, {
            fontSize: 9,
            align: 'center',
            color: MUTED,
          }),
          fieldEl('r-phone', 'store.phone', 0, 354, 198, 12, {
            fontSize: 8,
            align: 'center',
            color: MUTED,
          }),
        ],
      },
    ],
  );
  var receiptData = {
    store: { name: 'فروشگاه پارس', branch: 'شعبهٔ مرکزی — تهران', phone: '۰۲۱-۸۸۷۷۶۶۵۵' },
    receipt: {
      number: 'RC-140507-118',
      description: 'شارژ اشتراک سالانه',
      amount: '۴٬۸۵۰٬۰۰۰',
      method: 'کارت بانکی',
      ref: 'TRX-98213467',
    },
  };

  // --- ۷) پیش‌فاکتور ----------------------------------------------------------
  var proforma = baseTemplate('پیش‌فاکتور', page(), [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 700 },
      elements: [
        text('p-title', 'پیش‌فاکتور', 0, 0, 200, 30, {
          fontSize: 22,
          fontWeight: 'bold',
          color: BLUE,
        }),
        text('p-badge', 'غیرقابل استناد مالیاتی', 0, 34, 140, 14, { fontSize: 8, color: MUTED }),
        fieldEl('p-co', 'company.name', 300, 0, 223, 18, {
          fontSize: 12,
          fontWeight: 'bold',
          align: 'end',
        }),
        text('p-no-l', 'شماره:', 300, 26, 60, 13, { fontSize: 9, color: MUTED }),
        fieldEl('p-no', 'quote.number', 360, 26, 163, 13, { fontSize: 10, align: 'end' }),
        text('p-valid-l', 'معتبر تا:', 300, 44, 60, 13, { fontSize: 9, color: MUTED }),
        fieldEl('p-valid', 'quote.validUntil', 360, 44, 163, 13, { fontSize: 10, align: 'end' }),
        hline('p-ln1', 0, 70, 523, BLUE, 2),
        text('p-cust-l', 'مشتری:', 0, 86, 50, 14, { fontSize: 10, color: MUTED }),
        fieldEl('p-cust', 'customer.name', 52, 84, 240, 16, { fontSize: 12, fontWeight: 'bold' }),
        {
          id: 'p-tbl',
          type: 'table',
          bounds: { x: 0, y: 116, width: 523, height: 120 },
          zIndex: 1,
          dataset: 'items',
          columns: [
            {
              id: 'c-i',
              width: { kind: 'percent', value: 8 },
              header: { text: 'ردیف', styleId: 'cellHead' },
              detail: { content: { source: '$index + 1' }, styleId: 'cell' },
            },
            {
              id: 'c-name',
              width: { kind: 'percent', value: 42 },
              header: { text: 'شرح', styleId: 'cellHead' },
              detail: { content: { source: 'name' }, styleId: 'cell' },
            },
            {
              id: 'c-qty',
              width: { kind: 'percent', value: 12 },
              header: { text: 'تعداد', styleId: 'cellHead' },
              detail: { content: { source: 'qty' }, styleId: 'cell' },
            },
            {
              id: 'c-price',
              width: { kind: 'percent', value: 19 },
              header: { text: 'فی (ریال)', styleId: 'cellHead' },
              detail: { content: { source: 'price' }, styleId: 'cell' },
            },
            {
              id: 'c-sum',
              width: { kind: 'percent', value: 19 },
              header: { text: 'جمع (ریال)', styleId: 'cellHead' },
              detail: { content: { source: 'qty * price' }, styleId: 'cell' },
              footer: { aggregate: 'sum', styleId: 'cellHead' },
            },
          ],
        },
        text('p-total-l', 'جمع کل:', 330, 280, 60, 16, { fontSize: 12, fontWeight: 'bold' }),
        fieldEl('p-total', 'sum(items, qty * price)', 392, 280, 131, 18, {
          fontSize: 13,
          fontWeight: 'bold',
          color: BLUE,
          align: 'end',
        }),
        text(
          'p-terms',
          'شرایط: پرداخت ۵۰٪ پیش‌پرداخت — تحویل ۱۰ روز کاری پس از ثبت سفارش.',
          0,
          320,
          420,
          14,
          { fontSize: 9, color: MUTED },
        ),
      ],
    },
  ]);
  var proformaData = {
    company: { name: 'شرکت راهکار افزار' },
    customer: { name: 'فروشگاه زنجیره‌ای آفتاب' },
    quote: { number: 'PF-1405-0217', validUntil: '۱۴۰۵/۰۵/۳۱' },
    items: [
      { name: 'لایسنس نرم‌افزار انبار — ۱۰ کاربر', qty: 1, price: 480000000 },
      { name: 'استقرار و آموزش (روز)', qty: 3, price: 35000000 },
      { name: 'پشتیبانی سالانه', qty: 1, price: 96000000 },
    ],
  };

  // --- ۸) لیست بسته‌بندی ------------------------------------------------------
  var packing = baseTemplate('لیست بسته‌بندی', page(), [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 700 },
      elements: [
        text('k-title', 'لیست بسته‌بندی', 0, 0, 240, 26, { fontSize: 18, fontWeight: 'bold' }),
        {
          id: 'k-bc',
          type: 'barcode',
          symbology: 'code128',
          bounds: { x: 353, y: 0, width: 170, height: 44 },
          zIndex: 1,
          value: { source: 'order.number' },
          showText: true,
        },
        hline('k-ln1', 0, 58, 523, BLUE, 2),
        text('k-to-l', 'گیرنده:', 0, 74, 50, 14, { fontSize: 10, color: MUTED }),
        fieldEl('k-to', 'shipTo.name', 52, 72, 240, 16, { fontSize: 12, fontWeight: 'bold' }),
        fieldEl('k-addr', 'shipTo.address', 52, 92, 400, 14, { fontSize: 9, color: MUTED }),
        text('k-date-l', 'تاریخ ارسال:', 380, 74, 70, 13, { fontSize: 9, color: MUTED }),
        fieldEl('k-date', 'order.shipDate', 452, 74, 71, 13, { fontSize: 10, align: 'end' }),
        {
          id: 'k-tbl',
          type: 'table',
          bounds: { x: 0, y: 122, width: 523, height: 140 },
          zIndex: 1,
          dataset: 'items',
          columns: [
            {
              id: 'c-i',
              width: { kind: 'percent', value: 8 },
              header: { text: 'ردیف', styleId: 'cellHead' },
              detail: { content: { source: '$index + 1' }, styleId: 'cell' },
            },
            {
              id: 'c-desc',
              width: { kind: 'percent', value: 44 },
              header: { text: 'شرح کالا', styleId: 'cellHead' },
              detail: { content: { source: 'name' }, styleId: 'cell' },
            },
            {
              id: 'c-box',
              width: { kind: 'percent', value: 16 },
              header: { text: 'شمارهٔ کارتن', styleId: 'cellHead' },
              detail: { content: { source: 'box' }, styleId: 'cell' },
            },
            {
              id: 'c-qty',
              width: { kind: 'percent', value: 16 },
              header: { text: 'تعداد', styleId: 'cellHead' },
              detail: { content: { source: 'qty' }, styleId: 'cell' },
              footer: { aggregate: 'sum', styleId: 'cellHead' },
            },
            {
              id: 'c-wt',
              width: { kind: 'percent', value: 16 },
              header: { text: 'وزن (kg)', styleId: 'cellHead' },
              detail: { content: { source: 'weight' }, styleId: 'cell' },
              footer: { aggregate: 'sum', styleId: 'cellHead' },
            },
          ],
        },
        text(
          'k-note',
          'کالاها پیش از ارسال بازبینی و پلمب شده‌اند. لطفاً هنگام تحویل، تعداد کارتن‌ها را با این برگه تطبیق دهید.',
          0,
          300,
          460,
          14,
          { fontSize: 8.5, color: MUTED },
        ),
        hline('k-sig1', 20, 400, 150),
        text('k-sig1-l', 'مسئول انبار', 20, 408, 150, 14, { fontSize: 9, align: 'center' }),
        hline('k-sig2', 350, 400, 150),
        text('k-sig2-l', 'تحویل‌گیرنده', 350, 408, 150, 14, { fontSize: 9, align: 'center' }),
      ],
    },
  ]);
  var packingData = {
    order: { number: 'ORD-88412', shipDate: '۱۴۰۵/۰۴/۲۲' },
    shipTo: {
      name: 'فروشگاه مرکزی کوروش',
      address: 'اصفهان، خیابان چهارباغ بالا، مجتمع تجاری کوثر، واحد ۱۲',
    },
    items: [
      { name: 'مانیتور ۲۴ اینچ', box: 'K-01', qty: 4, weight: 18.4 },
      { name: 'کیس رایانه', box: 'K-02', qty: 4, weight: 26 },
      { name: 'کیبورد و ماوس', box: 'K-03', qty: 8, weight: 6.2 },
      { name: 'کابل و متعلقات', box: 'K-03', qty: 12, weight: 3.5 },
    ],
  };

  // --- ۹) کارت ویزیت ----------------------------------------------------------
  var card = baseTemplate(
    'کارت ویزیت',
    page({
      size: { width: 252, height: 144 },
      margins: { top: 16, right: 18, bottom: 16, left: 18 },
    }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 112 },
        elements: [
          {
            id: 'v-band',
            type: 'rectangle',
            bounds: { x: -18, y: -16, width: 6, height: 144 },
            zIndex: 1,
            box: { fill: { color: BLUE } },
          },
          fieldEl('v-name', 'person.name', 0, 4, 150, 20, { fontSize: 14, fontWeight: 'bold' }),
          fieldEl('v-role', 'person.role', 0, 27, 150, 13, { fontSize: 9, color: MUTED }),
          fieldEl('v-co', 'person.company', 0, 44, 150, 13, {
            fontSize: 10,
            fontWeight: 'bold',
            color: BLUE,
          }),
          hline('v-ln', 0, 68, 130),
          fieldEl('v-phone', 'person.phone', 0, 78, 150, 12, { fontSize: 8.5, color: MUTED }),
          fieldEl('v-mail', 'person.email', 0, 93, 150, 12, { fontSize: 8.5, color: MUTED }),
          {
            id: 'v-qr',
            type: 'qrcode',
            bounds: { x: 160, y: 34, width: 56, height: 56 },
            zIndex: 1,
            value: { source: 'person.site' },
          },
          text('v-site-l', 'اسکن کن', 160, 94, 56, 10, {
            fontSize: 7,
            color: MUTED,
            align: 'center',
          }),
        ],
      },
    ],
  );
  var cardData = {
    person: {
      name: 'نگار صادقی',
      role: 'مدیر محصول',
      company: 'استودیو نارنج',
      phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹',
      email: 'negar@naranj.studio',
      site: 'https://naranj.studio',
    },
  };

  // --- ۱۰) منوی رستوران --------------------------------------------------------
  var menu = baseTemplate(
    'منوی رستوران',
    page(),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 700 },
        elements: [
          fieldEl('m-name', 'restaurant.name', 0, 0, 523, 30, {
            fontSize: 24,
            fontWeight: 'bold',
            align: 'center',
          }),
          fieldEl('m-slogan', 'restaurant.slogan', 0, 36, 523, 14, {
            fontSize: 10,
            color: MUTED,
            align: 'center',
          }),
          hline('m-ln1', 180, 60, 163, BLUE, 2),
          text('m-hot-l', 'غذاهای اصلی', 0, 84, 200, 18, {
            fontSize: 13,
            fontWeight: 'bold',
            color: BLUE,
          }),
          {
            id: 'm-hot',
            type: 'table',
            bounds: { x: 0, y: 108, width: 523, height: 120 },
            zIndex: 1,
            dataset: 'mains',
            columns: [
              {
                id: 'c-n',
                width: { kind: 'percent', value: 40 },
                header: { text: 'نام', styleId: 'cellHead' },
                detail: { content: { source: 'name' }, styleId: 'cell' },
              },
              {
                id: 'c-d',
                width: { kind: 'percent', value: 42 },
                header: { text: 'توضیح', styleId: 'cellHead' },
                detail: { content: { source: 'desc' }, styleId: 'cell' },
              },
              {
                id: 'c-p',
                width: { kind: 'percent', value: 18 },
                header: { text: 'قیمت (هزار تومان)', styleId: 'cellHead' },
                detail: { content: { source: 'price' }, styleId: 'cell' },
              },
            ],
          },
          text('m-cold-l', 'نوشیدنی و دسر', 0, 268, 200, 18, {
            fontSize: 13,
            fontWeight: 'bold',
            color: BLUE,
          }),
          {
            id: 'm-cold',
            type: 'table',
            bounds: { x: 0, y: 292, width: 523, height: 100 },
            zIndex: 1,
            dataset: 'drinks',
            columns: [
              {
                id: 'c-n2',
                width: { kind: 'percent', value: 40 },
                header: { text: 'نام', styleId: 'cellHead' },
                detail: { content: { source: 'name' }, styleId: 'cell' },
              },
              {
                id: 'c-d2',
                width: { kind: 'percent', value: 42 },
                header: { text: 'توضیح', styleId: 'cellHead' },
                detail: { content: { source: 'desc' }, styleId: 'cell' },
              },
              {
                id: 'c-p2',
                width: { kind: 'percent', value: 18 },
                header: { text: 'قیمت (هزار تومان)', styleId: 'cellHead' },
                detail: { content: { source: 'price' }, styleId: 'cell' },
              },
            ],
          },
          text(
            'm-note',
            'قیمت‌ها شامل ۱۰٪ حق سرویس است — سفارش بیرون‌بر: داخلی ۲',
            0,
            430,
            523,
            14,
            {
              fontSize: 9,
              color: MUTED,
              align: 'center',
            },
          ),
          {
            id: 'm-qr',
            type: 'qrcode',
            bounds: { x: 232, y: 460, width: 60, height: 60 },
            zIndex: 1,
            value: { source: 'restaurant.orderUrl' },
          },
          text('m-qr-l', 'سفارش آنلاین', 212, 526, 100, 12, {
            fontSize: 8,
            color: MUTED,
            align: 'center',
          }),
        ],
      },
    ],
    {
      datasets: [
        { name: 'mains', source: { kind: 'path', path: 'mains' } },
        { name: 'drinks', source: { kind: 'path', path: 'drinks' } },
      ],
    },
  );
  var menuData = {
    restaurant: {
      name: 'رستوران بهارنارنج',
      slogan: 'طعم خانگی، از ۱۳۷۴',
      orderUrl: 'https://baharnaranj.ir/menu',
    },
    mains: [
      { name: 'چلوکباب سلطانی', desc: 'برگ و کوبیده، گوجه کبابی، برنج ایرانی', price: 485 },
      { name: 'زرشک‌پلو با مرغ', desc: 'ران مرغ زعفرانی، زرشک تازه', price: 320 },
      { name: 'قورمه‌سبزی', desc: 'گوشت گوسفندی، لیموعمانی، سبزی تازه', price: 295 },
      { name: 'باقالی‌پلو با ماهیچه', desc: 'ماهیچهٔ گوسفندی، شوید و باقالی', price: 540 },
    ],
    drinks: [
      { name: 'دوغ محلی', desc: 'نعناع و گل‌محمدی', price: 45 },
      { name: 'شربت زعفران', desc: 'با تخم شربتی', price: 55 },
      { name: 'بستنی سنتی', desc: 'زعفرانی با خلال پسته', price: 85 },
    ],
  };

  // --- ۱۱) گزارش کارکرد ماهانه --------------------------------------------------
  var timesheet = baseTemplate('گزارش کارکرد', page(), [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 700 },
      elements: [
        text('t-title', 'گزارش کارکرد ماهانه', 0, 0, 260, 24, { fontSize: 17, fontWeight: 'bold' }),
        text('t-emp-l', 'کارمند:', 320, 2, 50, 14, { fontSize: 9, color: MUTED }),
        fieldEl('t-emp', 'employee.name', 372, 0, 151, 16, {
          fontSize: 11,
          fontWeight: 'bold',
          align: 'end',
        }),
        text('t-mon-l', 'ماه:', 320, 22, 50, 13, { fontSize: 9, color: MUTED }),
        fieldEl('t-mon', 'employee.month', 372, 20, 151, 14, { fontSize: 10, align: 'end' }),
        hline('t-ln1', 0, 48, 523, BLUE, 2),
        {
          id: 't-tbl',
          type: 'table',
          bounds: { x: 0, y: 64, width: 523, height: 150 },
          zIndex: 1,
          dataset: 'items',
          columns: [
            {
              id: 'c-day',
              width: { kind: 'percent', value: 14 },
              header: { text: 'روز', styleId: 'cellHead' },
              detail: { content: { source: 'day' }, styleId: 'cell' },
            },
            {
              id: 'c-prj',
              width: { kind: 'percent', value: 28 },
              header: { text: 'پروژه', styleId: 'cellHead' },
              detail: { content: { source: 'project' }, styleId: 'cell' },
            },
            {
              id: 'c-desc',
              width: { kind: 'percent', value: 44 },
              header: { text: 'شرح فعالیت', styleId: 'cellHead' },
              detail: { content: { source: 'task' }, styleId: 'cell' },
            },
            {
              id: 'c-hr',
              width: { kind: 'percent', value: 14 },
              header: { text: 'ساعت', styleId: 'cellHead' },
              detail: { content: { source: 'hours' }, styleId: 'cell' },
              footer: { aggregate: 'sum', styleId: 'cellHead' },
            },
          ],
        },
        text('t-sum-l', 'جمع کارکرد:', 330, 280, 80, 16, { fontSize: 11, fontWeight: 'bold' }),
        fieldEl('t-sum', "sum(items, hours) + ' ساعت'", 412, 280, 111, 16, {
          fontSize: 12,
          fontWeight: 'bold',
          color: BLUE,
          align: 'end',
        }),
        hline('t-sig1', 20, 380, 150),
        text('t-sig1-l', 'امضای کارمند', 20, 388, 150, 14, { fontSize: 9, align: 'center' }),
        hline('t-sig2', 350, 380, 150),
        text('t-sig2-l', 'تأیید مدیر', 350, 388, 150, 14, { fontSize: 9, align: 'center' }),
      ],
    },
  ]);
  var timesheetData = {
    employee: { name: 'امیرحسین کاظمی', month: 'تیر ۱۴۰۵' },
    items: [
      { day: 'شنبه ۱', project: 'پرتال مشتریان', task: 'پیاده‌سازی صفحهٔ ورود', hours: 8 },
      { day: 'یکشنبه ۲', project: 'پرتال مشتریان', task: 'اتصال به سرویس پیامک', hours: 7.5 },
      { day: 'دوشنبه ۳', project: 'اپ انبار', task: 'رفع اشکال گزارش موجودی', hours: 6 },
      { day: 'سه‌شنبه ۴', project: 'اپ انبار', task: 'تست و مستندسازی', hours: 8 },
      { day: 'چهارشنبه ۵', project: 'پرتال مشتریان', task: 'بازبینی کد و انتشار', hours: 5.5 },
    ],
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
    {
      id: 'receipt',
      name: 'رسید پرداخت',
      desc: 'عرض ۸cm حرارتی + QR پیگیری',
      template: receipt,
      data: receiptData,
    },
    {
      id: 'proforma',
      name: 'پیش‌فاکتور',
      desc: 'با اعتبار، شرایط و جمع کل',
      template: proforma,
      data: proformaData,
    },
    {
      id: 'packing',
      name: 'لیست بسته‌بندی',
      desc: 'کارتن/تعداد/وزن + بارکد سفارش',
      template: packing,
      data: packingData,
    },
    {
      id: 'card',
      name: 'کارت ویزیت',
      desc: 'سایز استاندارد + QR سایت',
      template: card,
      data: cardData,
    },
    {
      id: 'menu',
      name: 'منوی رستوران',
      desc: 'دو بخش غذا/نوشیدنی + سفارش آنلاین',
      template: menu,
      data: menuData,
    },
    {
      id: 'timesheet',
      name: 'گزارش کارکرد',
      desc: 'تایم‌شیت با جمع ساعت و امضا',
      template: timesheet,
      data: timesheetData,
    },
  ];
})();
