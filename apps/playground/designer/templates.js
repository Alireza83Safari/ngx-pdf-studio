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
  function rgb(r, g, b, a) {
    var c = { space: 'rgb', r: r, g: g, b: b };
    if (a !== undefined) c.a = a;
    return c;
  }
  var INK = rgb(15, 23, 42);
  var MUTED = rgb(100, 116, 139);
  var HAIR = rgb(203, 213, 225);
  var PAPER = rgb(255, 255, 255);

  /**
   * Two themeable tokens. Every template paints its brand colour with `ACCENT`
   * and its light wash with `TINT`; `themeTemplate()` below swaps exactly those
   * two values, so one palette click re-skins the whole gallery (§8B).
   */
  var ACCENT = rgb(37, 99, 235);
  var TINT = rgb(219, 234, 254);
  var BLUE = ACCENT; // legacy alias used by the first-generation templates

  function page(overrides) {
    return Object.assign(
      {
        size: 'A4',
        orientation: 'portrait',
        margins: { top: 36, right: 36, bottom: 36, left: 36 },
        direction: 'rtl',
        locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
        unit: 'pt',
        // authored in reading order; `bakeLogical` flips it to physical below
        coordinates: 'logical',
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
      stroke: { width: width || 1, color: color || HAIR },
    };
  }
  /** Truly vertical rule (the painter draws bounds → bounds+size, so width 0). */
  function vline(id, x, y, h, color, width) {
    return {
      id: id,
      type: 'line',
      bounds: { x: x, y: y, width: 0, height: h },
      zIndex: 1,
      stroke: { width: width || 1, color: color || HAIR },
    };
  }
  /**
   * Background panel. `opts` = { fill, border, radius, borderWidth }. Painted at
   * zIndex 0 so it always sits under the content laid on top of it.
   */
  function panel(id, x, y, w, h, opts) {
    var o = opts || {};
    var box = {};
    if (o.fill) box.fill = { color: o.fill };
    if (o.border || o.radius !== undefined) {
      box.border = {};
      if (o.border) box.border.all = { width: o.borderWidth || 0.8, color: o.border };
      if (o.radius !== undefined) box.border.radius = o.radius;
    }
    return {
      id: id,
      type: 'rectangle',
      bounds: { x: x, y: y, width: w, height: h },
      zIndex: 0,
      box: box,
    };
  }
  function ellipse(id, x, y, w, h, opts) {
    var e = panel(id, x, y, w, h, opts);
    e.type = 'ellipse';
    return e;
  }
  function qr(id, x, y, w, h, src) {
    return {
      id: id,
      type: 'qrcode',
      bounds: { x: x, y: y, width: w, height: h },
      zIndex: 1,
      value: { source: src },
    };
  }
  function barcode(id, x, y, w, h, src, showText) {
    return {
      id: id,
      type: 'barcode',
      symbology: 'code128',
      bounds: { x: x, y: y, width: w, height: h },
      zIndex: 1,
      value: { source: src },
      showText: showText !== false,
    };
  }
  /** Label/value pair on one row — the workhorse of every form-like template. */
  function pair(idBase, label, src, x, y, w, labelW, ty) {
    return [
      text(idBase + '-l', label, x, y, labelW, 12, { fontSize: 8, color: MUTED }),
      fieldEl(idBase, src, x + labelW, y - 1, w - labelW, 13, Object.assign({ fontSize: 9 }, ty)),
    ];
  }
  /** Flatten nested element arrays so `pair()` can be spread inline. */
  function flat(list) {
    var out = [];
    list.forEach(function (item) {
      if (Object.prototype.toString.call(item) === '[object Array]') out = out.concat(flat(item));
      else if (item) out.push(item);
    });
    return out;
  }
  /** Standard body/header cell columns for a table. */
  function col(id, pct, header, src, footer) {
    var c = {
      id: id,
      width: { kind: 'percent', value: pct },
      header: { text: header, styleId: 'cellHead' },
      detail: { content: { source: src }, styleId: 'cell' },
    };
    if (footer) c.footer = { aggregate: footer, styleId: 'cellHead' };
    return c;
  }
  /**
   * These templates are right-to-left documents authored the way they read —
   * x=0 is where the eye starts (the right edge), the title precedes the meta
   * block, a label precedes its value. That is the engine's
   * `page.coordinates: 'logical'` convention.
   *
   * The *visual designer*, though, drags physical boxes: its overlays come
   * straight from `bounds`, so they would land on the mirrored side of whatever
   * the painters drew. So rather than shipping the flag, bake it — run the
   * engine's own `withLogicalBounds` once here and hand the designer physical
   * geometry. `withLogicalBounds` is its own inverse, so the flag has to come
   * back off afterwards or `layoutDocument` would mirror a second time.
   */
  function bakeLogical(template) {
    var P = window.PdfStudio;
    if (!P || typeof P.withLogicalBounds !== 'function') return template;
    var baked = P.withLogicalBounds(template);
    baked.page = Object.assign({}, baked.page, { coordinates: 'physical' });
    return baked;
  }

  function baseTemplate(name, pageSetup, bands, extra) {
    return bakeLogical(
      Object.assign(
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
              box: { fill: { color: TINT } },
            },
          ],
          datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
          parameters: [],
          bands: bands,
          resources: { fonts: [], images: [] },
        },
        extra || {},
      ),
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
  // NB: `resolvePageSize` normalises custom sizes to portrait, so any page that
  // is designed wider than it is tall must say so with `orientation`.
  var label = baseTemplate(
    'برچسب محصول',
    page({
      size: { width: 283, height: 170 },
      orientation: 'landscape',
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
      orientation: 'landscape',
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

  // --- ۰) سند خالی -------------------------------------------------------------
  var blank = baseTemplate('سند خالی', page(), [
    { id: 'main', type: 'reportHeader', height: { mode: 'fixed', value: 770 }, elements: [] },
  ]);
  var blankData = {
    company: { name: 'شرکت نمونه' },
    customer: { name: 'علی رضایی' },
    invoice: { number: 'INV-1405-0042' },
    items: [
      { name: 'کالای اول', qty: 2, price: 1250000 },
      { name: 'کالای دوم', qty: 1, price: 890000 },
    ],
  };

  // --- ۱۲) فاکتور رسمی مالیاتی (صورتحساب فروش کالا و خدمات) ---------------------
  var taxInvoice = baseTemplate(
    'فاکتور رسمی مالیاتی',
    page({ margins: { top: 28, right: 28, bottom: 28, left: 28 } }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 740 },
        elements: [
          // ---- سربرگ ----
          text('x-title', 'صورتحساب فروش کالا و خدمات', 0, 2, 539, 22, {
            fontSize: 15,
            fontWeight: 'bold',
            align: 'center',
          }),
          text('x-no-l', 'شماره سریال:', 0, 6, 70, 12, { fontSize: 8, color: MUTED }),
          fieldEl('x-no', 'invoice.serial', 72, 4, 90, 13, { fontSize: 9 }),
          text('x-date-l', 'تاریخ:', 449, 6, 35, 12, { fontSize: 8, color: MUTED }),
          {
            id: 'x-date',
            type: 'pageField',
            field: 'currentDate',
            bounds: { x: 484, y: 4, width: 55, height: 13 },
            zIndex: 1,
            typography: { fontFamily: V, fontSize: 9, color: INK },
          },
          // ---- مشخصات فروشنده ----
          {
            id: 'x-sbox',
            type: 'rectangle',
            bounds: { x: 0, y: 28, width: 539, height: 52 },
            zIndex: 1,
            box: { border: { all: { width: 0.8, color: rgb(120, 130, 150) } } },
          },
          text('x-s-t', 'مشخصات فروشنده', 6, 32, 100, 12, {
            fontSize: 8.5,
            fontWeight: 'bold',
            color: BLUE,
          }),
          text('x-s-n-l', 'نام:', 6, 47, 25, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-s-n', 'seller.name', 32, 45, 180, 12, { fontSize: 9 }),
          text('x-s-id-l', 'شمارهٔ اقتصادی:', 220, 47, 70, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-s-id', 'seller.taxId', 292, 45, 100, 12, { fontSize: 9 }),
          text('x-s-nid-l', 'شناسهٔ ملی:', 398, 47, 55, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-s-nid', 'seller.nationalId', 454, 45, 82, 12, { fontSize: 9 }),
          text('x-s-a-l', 'نشانی:', 6, 63, 30, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-s-a', 'seller.address', 38, 61, 380, 12, { fontSize: 8 }),
          text('x-s-p-l', 'کدپستی:', 424, 63, 40, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-s-p', 'seller.postalCode', 466, 61, 70, 12, { fontSize: 8.5 }),
          // ---- مشخصات خریدار ----
          {
            id: 'x-bbox',
            type: 'rectangle',
            bounds: { x: 0, y: 86, width: 539, height: 52 },
            zIndex: 1,
            box: { border: { all: { width: 0.8, color: rgb(120, 130, 150) } } },
          },
          text('x-b-t', 'مشخصات خریدار', 6, 90, 100, 12, {
            fontSize: 8.5,
            fontWeight: 'bold',
            color: BLUE,
          }),
          text('x-b-n-l', 'نام:', 6, 105, 25, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-b-n', 'buyer.name', 32, 103, 180, 12, { fontSize: 9 }),
          text('x-b-id-l', 'شمارهٔ اقتصادی:', 220, 105, 70, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-b-id', 'buyer.taxId', 292, 103, 100, 12, { fontSize: 9 }),
          text('x-b-nid-l', 'شناسهٔ ملی:', 398, 105, 55, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-b-nid', 'buyer.nationalId', 454, 103, 82, 12, { fontSize: 9 }),
          text('x-b-a-l', 'نشانی:', 6, 121, 30, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-b-a', 'buyer.address', 38, 119, 380, 12, { fontSize: 8 }),
          text('x-b-p-l', 'کدپستی:', 424, 121, 40, 11, { fontSize: 8, color: MUTED }),
          fieldEl('x-b-p', 'buyer.postalCode', 466, 119, 70, 12, { fontSize: 8.5 }),
          // ---- جدول اقلام ----
          {
            id: 'x-tbl',
            type: 'table',
            bounds: { x: 0, y: 148, width: 539, height: 150 },
            zIndex: 1,
            dataset: 'items',
            columns: [
              {
                id: 'c-i',
                width: { kind: 'percent', value: 5 },
                header: { text: 'ردیف', styleId: 'cellHead' },
                detail: { content: { source: '$index + 1' }, styleId: 'cell' },
              },
              {
                id: 'c-code',
                width: { kind: 'percent', value: 10 },
                header: { text: 'کد کالا', styleId: 'cellHead' },
                detail: { content: { source: 'code' }, styleId: 'cell' },
              },
              {
                id: 'c-desc',
                width: { kind: 'percent', value: 24 },
                header: { text: 'شرح کالا/خدمت', styleId: 'cellHead' },
                detail: { content: { source: 'name' }, styleId: 'cell' },
              },
              {
                id: 'c-qty',
                width: { kind: 'percent', value: 7 },
                header: { text: 'تعداد', styleId: 'cellHead' },
                detail: { content: { source: 'qty' }, styleId: 'cell' },
              },
              {
                id: 'c-unit',
                width: { kind: 'percent', value: 12 },
                header: { text: 'مبلغ واحد', styleId: 'cellHead' },
                detail: { content: { source: 'price' }, styleId: 'cell' },
              },
              {
                id: 'c-total',
                width: { kind: 'percent', value: 14 },
                header: { text: 'مبلغ کل', styleId: 'cellHead' },
                detail: { content: { source: 'qty * price' }, styleId: 'cell' },
                footer: { aggregate: 'sum', styleId: 'cellHead' },
              },
              {
                id: 'c-disc',
                width: { kind: 'percent', value: 9 },
                header: { text: 'تخفیف', styleId: 'cellHead' },
                detail: { content: { source: 'discount' }, styleId: 'cell' },
                footer: { aggregate: 'sum', styleId: 'cellHead' },
              },
              {
                id: 'c-vat',
                width: { kind: 'percent', value: 9 },
                header: { text: 'مالیات ۱۰٪', styleId: 'cellHead' },
                detail: { content: { source: '(qty * price - discount) * 0.1' }, styleId: 'cell' },
              },
              {
                id: 'c-net',
                width: { kind: 'percent', value: 10 },
                header: { text: 'قابل پرداخت', styleId: 'cellHead' },
                detail: { content: { source: '(qty * price - discount) * 1.1' }, styleId: 'cell' },
              },
            ],
          },
          // ---- جمع‌ها ----
          text('x-sum-l', 'جمع کل (ریال):', 300, 320, 90, 13, { fontSize: 9, color: MUTED }),
          fieldEl('x-sum', 'sum(items, qty * price)', 392, 318, 147, 14, {
            fontSize: 10,
            align: 'end',
          }),
          text('x-disc-l', 'جمع تخفیف:', 300, 338, 90, 13, { fontSize: 9, color: MUTED }),
          fieldEl('x-disc', 'sum(items, discount)', 392, 336, 147, 14, {
            fontSize: 10,
            align: 'end',
          }),
          text('x-vat-l', 'مالیات بر ارزش افزوده:', 300, 356, 90, 13, {
            fontSize: 9,
            color: MUTED,
          }),
          fieldEl('x-vat', 'sum(items, (qty * price - discount) * 0.1)', 392, 354, 147, 14, {
            fontSize: 10,
            align: 'end',
          }),
          hline('x-ln2', 300, 374, 239, BLUE, 1),
          text('x-pay-l', 'مبلغ قابل پرداخت:', 300, 382, 100, 14, {
            fontSize: 10,
            fontWeight: 'bold',
          }),
          fieldEl('x-pay', 'sum(items, (qty * price - discount) * 1.1)', 402, 380, 137, 16, {
            fontSize: 12,
            fontWeight: 'bold',
            color: BLUE,
            align: 'end',
          }),
          // ---- مبلغ به حروف (toWords!) ----
          {
            id: 'x-words-box',
            type: 'rectangle',
            bounds: { x: 0, y: 320, width: 290, height: 42 },
            zIndex: 1,
            box: {
              fill: { color: rgb(246, 248, 251) },
              border: { all: { width: 0.8, color: rgb(203, 213, 225) } },
            },
          },
          text('x-words-l', 'مبلغ به حروف:', 8, 326, 80, 12, { fontSize: 8.5, color: MUTED }),
          fieldEl(
            'x-words',
            "toWords(round(sum(items, (qty * price - discount) * 1.1)), 'rial')",
            8,
            340,
            274,
            14,
            { fontSize: 9, fontWeight: 'bold' },
          ),
          // ---- QR مودیان + امضاها ----
          {
            id: 'x-qr',
            type: 'qrcode',
            bounds: { x: 0, y: 380, width: 64, height: 64 },
            zIndex: 1,
            value: { source: 'invoice.taxUid' },
          },
          text('x-qr-l', 'کد یکتای مالیاتی', 0, 448, 64, 11, {
            fontSize: 6.5,
            color: MUTED,
            align: 'center',
          }),
          fieldEl('x-uid', 'invoice.taxUid', 72, 400, 180, 12, { fontSize: 7.5, color: MUTED }),
          hline('x-sig1', 90, 560, 140, rgb(148, 163, 184), 1),
          text('x-sig1-l', 'مهر و امضای فروشنده', 90, 568, 140, 13, {
            fontSize: 8.5,
            align: 'center',
          }),
          hline('x-sig2', 320, 560, 140, rgb(148, 163, 184), 1),
          text('x-sig2-l', 'مهر و امضای خریدار', 320, 568, 140, 13, {
            fontSize: 8.5,
            align: 'center',
          }),
          text(
            'x-foot',
            'این صورتحساب مطابق ماده ۱۹ قانون مالیات بر ارزش افزوده صادر شده است.',
            0,
            600,
            539,
            12,
            { fontSize: 7.5, color: MUTED, align: 'center' },
          ),
        ],
      },
    ],
  );
  var taxInvoiceData = {
    invoice: { serial: '۱۴۰۵-۰۰۲۱۷', taxUid: 'A1B2C3D4E5F6G7H8I9J0K1L2' },
    seller: {
      name: 'شرکت بازرگانی نمونهٔ پارس (سهامی خاص)',
      taxId: '411111111111',
      nationalId: '10102345678',
      address: 'تهران، خیابان ولیعصر، بالاتر از میدان ونک، پلاک ۲۵۴۰',
      postalCode: '1969633111',
    },
    buyer: {
      name: 'فروشگاه زنجیره‌ای آفتاب',
      taxId: '422222222222',
      nationalId: '10209876543',
      address: 'اصفهان، خیابان چهارباغ بالا، مجتمع کوثر، واحد ۱۲',
      postalCode: '8173654321',
    },
    items: [
      { code: 'K-1101', name: 'مانیتور ۲۴ اینچ', qty: 4, price: 89500000, discount: 8000000 },
      { code: 'K-1102', name: 'کیس رایانه', qty: 4, price: 152000000, discount: 0 },
      {
        code: 'S-2001',
        name: 'خدمات نصب و راه‌اندازی',
        qty: 1,
        price: 25000000,
        discount: 5000000,
      },
    ],
  };

  // --- ۱۳) فیش حقوقی ------------------------------------------------------------
  var payslip = baseTemplate(
    'فیش حقوقی',
    page(),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 740 },
        elements: flat([
          panel('ps-hd', 0, 0, 523, 62, { fill: ACCENT, radius: 10 }),
          text('ps-title', 'فیش حقوقی', 14, 10, 240, 24, {
            fontSize: 17,
            fontWeight: 'bold',
            color: PAPER,
          }),
          fieldEl('ps-co', 'company.name', 14, 38, 260, 14, {
            fontSize: 9,
            color: rgb(255, 255, 255, 0.85),
          }),
          text('ps-mon-l', 'دورهٔ حقوقی', 300, 12, 209, 12, {
            fontSize: 8,
            color: rgb(255, 255, 255, 0.8),
            align: 'end',
          }),
          fieldEl('ps-mon', 'payroll.period', 300, 26, 209, 22, {
            fontSize: 14,
            fontWeight: 'bold',
            color: PAPER,
            align: 'end',
          }),

          panel('ps-ib', 0, 76, 523, 62, { fill: rgb(248, 250, 252), border: HAIR, radius: 8 }),
          pair('ps-nm', 'نام و نام‌خانوادگی', 'employee.name', 12, 90, 245, 92, {
            fontSize: 10,
            fontWeight: 'bold',
          }),
          pair('ps-cd', 'کد پرسنلی', 'employee.code', 275, 90, 236, 70),
          pair('ps-rl', 'سمت سازمانی', 'employee.role', 12, 112, 245, 92),
          pair('ps-ac', 'شمارهٔ حساب', 'employee.account', 275, 112, 236, 70),

          text('ps-e-h', 'دریافتی‌ها', 0, 152, 200, 16, {
            fontSize: 11,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          {
            id: 'ps-e',
            type: 'table',
            bounds: { x: 0, y: 174, width: 255, height: 140 },
            zIndex: 1,
            dataset: 'earnings',
            rowStripeStyleId: 'cell',
            repeatHeader: true,
            columns: [
              col('pe-t', 58, 'عنوان', 'title'),
              col('pe-a', 42, 'مبلغ (ریال)', 'amount', 'sum'),
            ],
          },

          text('ps-d-h', 'کسورات', 268, 152, 200, 16, {
            fontSize: 11,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          {
            id: 'ps-d',
            type: 'table',
            bounds: { x: 268, y: 174, width: 255, height: 140 },
            zIndex: 1,
            dataset: 'deductions',
            rowStripeStyleId: 'cell',
            repeatHeader: true,
            columns: [
              col('pd-t', 58, 'عنوان', 'title'),
              col('pd-a', 42, 'مبلغ (ریال)', 'amount', 'sum'),
            ],
          },

          panel('ps-net', 0, 350, 523, 76, { fill: TINT, radius: 10 }),
          text('ps-net-l', 'خالص پرداختی', 16, 362, 200, 14, { fontSize: 10, color: MUTED }),
          fieldEl('ps-net-v', 'sum(earnings, amount) - sum(deductions, amount)', 16, 380, 230, 28, {
            fontSize: 21,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          text('ps-net-u', 'ریال', 16, 410, 60, 12, { fontSize: 8, color: MUTED }),
          text('ps-w-l', 'به حروف', 268, 362, 240, 12, { fontSize: 8, color: MUTED }),
          fieldEl(
            'ps-w',
            "toWords(round(sum(earnings, amount) - sum(deductions, amount)), 'rial')",
            268,
            378,
            241,
            34,
            { fontSize: 9, fontWeight: 'bold', lineHeight: 1.6 },
          ),

          qr('ps-qr', 0, 444, 62, 62, 'payroll.slipId'),
          text('ps-qr-l', 'کد فیش', 0, 508, 62, 11, { fontSize: 7, color: MUTED, align: 'center' }),
          text('ps-id-l', 'شناسهٔ فیش:', 74, 448, 70, 12, { fontSize: 8, color: MUTED }),
          fieldEl('ps-id', 'payroll.slipId', 74, 462, 200, 13, { fontSize: 9 }),
          text(
            'ps-note',
            'این فیش به‌صورت الکترونیکی صادر شده است. در صورت مغایرت، ظرف ۷ روز کاری به واحد منابع انسانی اطلاع دهید.',
            74,
            484,
            300,
            26,
            { fontSize: 7.5, color: MUTED, lineHeight: 1.6 },
          ),
          hline('ps-sig', 340, 500, 180, HAIR, 1),
          text('ps-sig-l', 'مهر و امضای کارفرما', 340, 508, 180, 13, {
            fontSize: 8.5,
            align: 'center',
            color: MUTED,
          }),
        ]),
      },
    ],
    {
      datasets: [
        { name: 'earnings', source: { kind: 'path', path: 'earnings' } },
        { name: 'deductions', source: { kind: 'path', path: 'deductions' } },
      ],
    },
  );
  var payslipData = {
    company: { name: 'شرکت فناوری نوآوران' },
    payroll: { period: 'تیر ۱۴۰۵', slipId: 'PS-1405-04-0231' },
    employee: {
      name: 'امیرحسین کاظمی',
      code: '۱۰۲۴۷',
      role: 'کارشناس ارشد نرم‌افزار',
      account: 'IR۳۲۰۱۷۰۰۰۰۰۲۱۱۰۸۴۵۶۹۰۰۱',
    },
    earnings: [
      { title: 'حقوق پایه', amount: 145000000 },
      { title: 'حق مسکن و خواربار', amount: 22000000 },
      { title: 'حق اولاد', amount: 8500000 },
      { title: 'اضافه‌کاری (۲۴ ساعت)', amount: 31200000 },
      { title: 'پاداش عملکرد', amount: 40000000 },
    ],
    deductions: [
      { title: 'بیمهٔ تأمین اجتماعی', amount: 25690000 },
      { title: 'مالیات بر حقوق', amount: 14300000 },
      { title: 'وام مسکن', amount: 12000000 },
      { title: 'بیمهٔ تکمیلی', amount: 3400000 },
    ],
  };

  // --- ۱۴) قرارداد خدمات ---------------------------------------------------------
  var contract = baseTemplate(
    'قرارداد خدمات',
    page(),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 740 },
        elements: flat([
          panel('ct-hd', 0, 0, 523, 56, { fill: TINT, radius: 10 }),
          text('ct-title', 'قرارداد ارائهٔ خدمات', 0, 8, 523, 26, {
            fontSize: 19,
            fontWeight: 'bold',
            color: ACCENT,
            align: 'center',
          }),
          text('ct-no-l', 'شمارهٔ قرارداد:', 16, 38, 70, 12, { fontSize: 8, color: MUTED }),
          fieldEl('ct-no', 'contract.number', 88, 37, 130, 13, { fontSize: 9, fontWeight: 'bold' }),
          text('ct-dt-l', 'تاریخ انعقاد:', 330, 38, 60, 12, { fontSize: 8, color: MUTED }),
          fieldEl('ct-dt', 'contract.date', 392, 37, 115, 13, {
            fontSize: 9,
            fontWeight: 'bold',
            align: 'end',
          }),

          panel('ct-p1', 0, 70, 255, 72, { border: HAIR, radius: 8 }),
          text('ct-p1-t', 'طرف اول — کارفرما', 10, 76, 200, 13, {
            fontSize: 9,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          fieldEl('ct-p1-n', 'employer.name', 10, 92, 235, 15, {
            fontSize: 10,
            fontWeight: 'bold',
          }),
          pair('ct-p1-i', 'شناسهٔ ملی', 'employer.nationalId', 10, 112, 235, 60),
          pair('ct-p1-r', 'نمایندهٔ قانونی', 'employer.rep', 10, 128, 235, 60),

          panel('ct-p2', 268, 70, 255, 72, { border: HAIR, radius: 8 }),
          text('ct-p2-t', 'طرف دوم — پیمانکار', 278, 76, 200, 13, {
            fontSize: 9,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          fieldEl('ct-p2-n', 'contractor.name', 278, 92, 235, 15, {
            fontSize: 10,
            fontWeight: 'bold',
          }),
          pair('ct-p2-i', 'شناسهٔ ملی', 'contractor.nationalId', 278, 112, 235, 60),
          pair('ct-p2-r', 'نمایندهٔ قانونی', 'contractor.rep', 278, 128, 235, 60),

          text('ct-cl-h', 'مواد قرارداد', 0, 158, 200, 16, {
            fontSize: 11,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          {
            id: 'ct-cl',
            type: 'list',
            dataset: 'clauses',
            bounds: { x: 0, y: 182, width: 523, height: 300 },
            zIndex: 1,
            itemHeight: 54,
            gap: 8,
            itemTemplate: [
              panel('cl-bg', 0, 0, 523, 54, { fill: rgb(248, 250, 252), radius: 8 }),
              panel('cl-tab', 0, 0, 4, 54, { fill: ACCENT, radius: 2 }),
              fieldEl('cl-n', "'مادهٔ ' + ($index + 1)", 14, 7, 70, 12, {
                fontSize: 8,
                fontWeight: 'bold',
                color: ACCENT,
              }),
              fieldEl('cl-t', 'title', 88, 6, 300, 14, { fontSize: 10, fontWeight: 'bold' }),
              fieldEl('cl-b', 'body', 14, 24, 495, 26, {
                fontSize: 8.5,
                color: MUTED,
                lineHeight: 1.6,
              }),
            ],
          },

          hline('ct-ln2', 0, 520, 523, HAIR, 1),
          text(
            'ct-note',
            'این قرارداد در ۲ نسخهٔ واحد‌الاعتبار تنظیم و پس از امضای طرفین لازم‌الاجرا است.',
            0,
            532,
            523,
            14,
            { fontSize: 8.5, color: MUTED, align: 'center' },
          ),
          hline('ct-s1', 40, 600, 180, HAIR, 1),
          text('ct-s1-l', 'مهر و امضای کارفرما', 40, 608, 180, 13, {
            fontSize: 9,
            align: 'center',
          }),
          hline('ct-s2', 300, 600, 180, HAIR, 1),
          text('ct-s2-l', 'مهر و امضای پیمانکار', 300, 608, 180, 13, {
            fontSize: 9,
            align: 'center',
          }),
        ]),
      },
    ],
    { datasets: [{ name: 'clauses', source: { kind: 'path', path: 'clauses' } }] },
  );
  var contractData = {
    contract: { number: 'CT-1405-0087', date: '۱۴۰۵/۰۴/۱۵' },
    employer: {
      name: 'شرکت بازرگانی نمونهٔ پارس',
      nationalId: '۱۰۱۰۲۳۴۵۶۷۸',
      rep: 'مهندس رضا احمدی',
    },
    contractor: {
      name: 'استودیو نرم‌افزاری نارنج',
      nationalId: '۱۴۰۰۹۸۷۶۵۴۳',
      rep: 'نگار صادقی',
    },
    clauses: [
      {
        title: 'موضوع قرارداد',
        body: 'طراحی، پیاده‌سازی و استقرار سامانهٔ گزارش‌ساز سازمانی مطابق سند نیازمندی‌های پیوست شمارهٔ ۱.',
      },
      {
        title: 'مدت قرارداد',
        body: 'مدت اجرا شش ماه شمسی از تاریخ ابلاغ است و تمدید آن منوط به توافق کتبی طرفین خواهد بود.',
      },
      {
        title: 'مبلغ و نحوهٔ پرداخت',
        body: 'مبلغ کل ۲٬۴۰۰٬۰۰۰٬۰۰۰ ریال، در چهار قسط مساوی و پس از تأیید هر فاز پرداخت می‌شود.',
      },
      {
        title: 'تعهدات پیمانکار',
        body: 'تحویل به‌موقع فازها، رعایت استانداردهای امنیتی و ارائهٔ مستندات فنی و آموزش کاربران.',
      },
      {
        title: 'محرمانگی',
        body: 'طرفین متعهدند اطلاعات فنی و تجاری یکدیگر را تا سه سال پس از خاتمهٔ قرارداد محرمانه نگاه دارند.',
      },
      {
        title: 'فسخ و حل اختلاف',
        body: 'در صورت بروز اختلاف، موضوع ابتدا از طریق مذاکره و در غیر این صورت از طریق داوری مرضی‌الطرفین حل می‌شود.',
      },
    ],
  };

  // --- ۱۵) رزومهٔ حرفه‌ای ----------------------------------------------------------
  var resume = baseTemplate(
    'رزومهٔ حرفه‌ای',
    page({ margins: { top: 30, right: 30, bottom: 30, left: 30 } }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 736 },
        elements: flat([
          // ---- ستون کناری (برند) ----
          panel('cv-side', 365, 0, 170, 736, { fill: ACCENT }),
          ellipse('cv-av', 410, 26, 80, 80, {
            fill: rgb(255, 255, 255, 0.18),
            border: rgb(255, 255, 255, 0.55),
            borderWidth: 1.5,
          }),
          fieldEl('cv-ini', 'person.initials', 410, 52, 80, 30, {
            fontSize: 24,
            fontWeight: 'bold',
            color: PAPER,
            align: 'center',
          }),
          fieldEl('cv-nm', 'person.name', 375, 120, 150, 22, {
            fontSize: 15,
            fontWeight: 'bold',
            color: PAPER,
            align: 'center',
          }),
          fieldEl('cv-rl', 'person.role', 375, 144, 150, 14, {
            fontSize: 9,
            color: rgb(255, 255, 255, 0.85),
            align: 'center',
          }),
          hline('cv-s1', 385, 172, 130, rgb(255, 255, 255, 0.35), 1),

          text('cv-c-h', 'ارتباط', 375, 186, 150, 14, {
            fontSize: 9.5,
            fontWeight: 'bold',
            color: PAPER,
          }),
          fieldEl('cv-ph', 'person.phone', 375, 204, 150, 12, {
            fontSize: 8,
            color: rgb(255, 255, 255, 0.9),
          }),
          fieldEl('cv-em', 'person.email', 375, 220, 150, 12, {
            fontSize: 8,
            color: rgb(255, 255, 255, 0.9),
          }),
          fieldEl('cv-st', 'person.site', 375, 236, 150, 12, {
            fontSize: 8,
            color: rgb(255, 255, 255, 0.9),
          }),
          fieldEl('cv-ct', 'person.city', 375, 252, 150, 12, {
            fontSize: 8,
            color: rgb(255, 255, 255, 0.9),
          }),

          text('cv-sk-h', 'مهارت‌ها', 375, 282, 150, 14, {
            fontSize: 9.5,
            fontWeight: 'bold',
            color: PAPER,
          }),
          {
            id: 'cv-sk',
            type: 'list',
            dataset: 'skills',
            bounds: { x: 375, y: 302, width: 150, height: 160 },
            zIndex: 1,
            itemHeight: 30,
            itemTemplate: [
              fieldEl('sk-n', 'name', 0, 0, 110, 12, { fontSize: 8, color: PAPER }),
              fieldEl('sk-v', "level + '٪'", 110, 0, 40, 12, {
                fontSize: 7.5,
                color: rgb(255, 255, 255, 0.75),
                align: 'end',
              }),
              {
                id: 'sk-bar',
                type: 'rectangle',
                bounds: { x: 0, y: 15, width: 150, height: 6 },
                zIndex: 1,
                box: { fill: { color: rgb(255, 255, 255, 0.25) }, border: { radius: 3 } },
                dataBar: { value: { source: 'level' }, min: 0, max: 100, color: PAPER },
              },
            ],
          },

          text('cv-lg-h', 'زبان‌ها', 375, 480, 150, 14, {
            fontSize: 9.5,
            fontWeight: 'bold',
            color: PAPER,
          }),
          {
            id: 'cv-lg',
            type: 'list',
            dataset: 'languages',
            bounds: { x: 375, y: 500, width: 150, height: 60 },
            zIndex: 1,
            itemHeight: 17,
            itemTemplate: [
              fieldEl('lg-n', 'name', 0, 0, 90, 12, { fontSize: 8, color: PAPER }),
              fieldEl('lg-l', 'level', 90, 0, 60, 12, {
                fontSize: 7.5,
                color: rgb(255, 255, 255, 0.75),
                align: 'end',
              }),
            ],
          },
          qr('cv-qr', 420, 640, 60, 60, 'person.site'),

          // ---- ستون اصلی ----
          text('cv-sm-h', 'خلاصهٔ حرفه‌ای', 0, 6, 200, 18, {
            fontSize: 12,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          hline('cv-sm-r', 0, 26, 60, ACCENT, 2),
          fieldEl('cv-sm', 'person.summary', 0, 36, 345, 50, {
            fontSize: 9,
            color: MUTED,
            lineHeight: 1.8,
          }),

          text('cv-jb-h', 'سوابق شغلی', 0, 100, 200, 18, {
            fontSize: 12,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          hline('cv-jb-r', 0, 120, 60, ACCENT, 2),
          {
            id: 'cv-jb',
            type: 'list',
            dataset: 'jobs',
            bounds: { x: 0, y: 132, width: 345, height: 220 },
            zIndex: 1,
            itemHeight: 66,
            gap: 8,
            itemTemplate: [
              ellipse('jb-d', 1, 4, 8, 8, { fill: ACCENT }),
              vline('jb-v', 5, 16, 46, TINT, 1.5),
              fieldEl('jb-t', 'title', 18, 0, 200, 15, { fontSize: 10.5, fontWeight: 'bold' }),
              fieldEl('jb-c', 'company', 18, 17, 200, 12, { fontSize: 8.5, color: ACCENT }),
              fieldEl('jb-p', 'period', 220, 0, 125, 12, {
                fontSize: 8,
                color: MUTED,
                align: 'end',
              }),
              fieldEl('jb-b', 'summary', 18, 32, 327, 30, {
                fontSize: 8,
                color: MUTED,
                lineHeight: 1.6,
              }),
            ],
          },

          text('cv-ed-h', 'تحصیلات', 0, 372, 200, 18, {
            fontSize: 12,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          hline('cv-ed-r', 0, 392, 60, ACCENT, 2),
          {
            id: 'cv-ed',
            type: 'list',
            dataset: 'education',
            bounds: { x: 0, y: 404, width: 345, height: 90 },
            zIndex: 1,
            itemHeight: 36,
            gap: 6,
            itemTemplate: [
              panel('ed-bg', 0, 0, 345, 36, { fill: rgb(248, 250, 252), radius: 6 }),
              fieldEl('ed-d', 'degree', 10, 4, 220, 14, { fontSize: 9.5, fontWeight: 'bold' }),
              fieldEl('ed-s', 'school', 10, 19, 220, 12, { fontSize: 8, color: MUTED }),
              fieldEl('ed-y', 'year', 240, 10, 95, 12, {
                fontSize: 8,
                color: ACCENT,
                align: 'end',
              }),
            ],
          },

          text('cv-pr-h', 'پروژه‌های شاخص', 0, 512, 220, 18, {
            fontSize: 12,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          hline('cv-pr-r', 0, 532, 60, ACCENT, 2),
          {
            id: 'cv-pr',
            type: 'list',
            dataset: 'projects',
            bounds: { x: 0, y: 544, width: 345, height: 110 },
            zIndex: 1,
            itemHeight: 32,
            gap: 4,
            itemTemplate: [
              panel('pr-d', 2, 6, 6, 6, { fill: ACCENT, radius: 3 }),
              fieldEl('pr-n', 'name', 18, 0, 200, 13, { fontSize: 9.5, fontWeight: 'bold' }),
              fieldEl('pr-s', 'stack', 220, 1, 125, 12, {
                fontSize: 7.5,
                color: ACCENT,
                align: 'end',
              }),
              fieldEl('pr-b', 'summary', 18, 15, 327, 14, { fontSize: 8, color: MUTED }),
            ],
          },
        ]),
      },
    ],
    {
      datasets: [
        { name: 'skills', source: { kind: 'path', path: 'skills' } },
        { name: 'languages', source: { kind: 'path', path: 'languages' } },
        { name: 'jobs', source: { kind: 'path', path: 'jobs' } },
        { name: 'education', source: { kind: 'path', path: 'education' } },
        { name: 'projects', source: { kind: 'path', path: 'projects' } },
      ],
    },
  );
  var resumeData = {
    person: {
      name: 'نگار صادقی',
      initials: 'ن ص',
      role: 'مهندس ارشد نرم‌افزار',
      phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹',
      email: 'negar@naranj.studio',
      site: 'https://naranj.studio',
      city: 'تهران، ایران',
      summary:
        'هشت سال تجربهٔ طراحی و پیاده‌سازی سامانه‌های تحت وب در مقیاس سازمانی، با تمرکز بر معماری فرانت‌اند، کارایی و تجربهٔ کاربری فارسی‌زبان.',
    },
    skills: [
      { name: 'TypeScript / Angular', level: 95 },
      { name: 'معماری فرانت‌اند', level: 88 },
      { name: 'Node.js و طراحی API', level: 80 },
      { name: 'طراحی رابط کاربری', level: 72 },
      { name: 'تست و CI/CD', level: 85 },
    ],
    languages: [
      { name: 'فارسی', level: 'زبان مادری' },
      { name: 'انگلیسی', level: 'پیشرفته' },
      { name: 'آلمانی', level: 'مقدماتی' },
    ],
    jobs: [
      {
        title: 'مهندس ارشد نرم‌افزار',
        company: 'استودیو نارنج',
        period: '۱۴۰۲ — اکنون',
        summary:
          'راهبری تیم چهارنفرهٔ فرانت‌اند، بازطراحی معماری داشبورد سازمانی و کاهش ۴۰٪ زمان بارگذاری اولیه.',
      },
      {
        title: 'توسعه‌دهندهٔ فرانت‌اند',
        company: 'شرکت فناوری نوآوران',
        period: '۱۳۹۹ — ۱۴۰۲',
        summary:
          'پیاده‌سازی پرتال مشتریان با Angular و طراحی کتابخانهٔ کامپوننت‌های راست‌به‌چپ مورد استفاده در پنج محصول.',
      },
      {
        title: 'توسعه‌دهندهٔ وب',
        company: 'آژانس دیجیتال آبان',
        period: '۱۳۹۷ — ۱۳۹۹',
        summary: 'ساخت بیش از ۲۰ وب‌سایت واکنش‌گرا و راه‌اندازی فرایند انتشار خودکار.',
      },
    ],
    education: [
      { degree: 'کارشناسی ارشد مهندسی نرم‌افزار', school: 'دانشگاه صنعتی شریف', year: '۱۳۹۷' },
      { degree: 'کارشناسی مهندسی کامپیوتر', school: 'دانشگاه تهران', year: '۱۳۹۴' },
    ],
    projects: [
      {
        name: 'PDF Studio',
        stack: 'TypeScript',
        summary: 'موتور تولید PDF فارسی با گزارش‌ساز دیداری.',
      },
      {
        name: 'سامانهٔ انبار ابری',
        stack: 'Angular · Node',
        summary: 'مدیریت موجودی چندانباره با گزارش‌های زنده.',
      },
      {
        name: 'کتابخانهٔ RTL-UI',
        stack: 'CSS · a11y',
        summary: 'مجموعه کامپوننت‌های راست‌به‌چپ متن‌باز.',
      },
    ],
  };

  // --- ۱۶) بلیط رویداد ------------------------------------------------------------
  var ticket = baseTemplate(
    'بلیط رویداد',
    page({
      size: { width: 560, height: 210 },
      orientation: 'landscape',
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 182 },
        elements: flat([
          panel('tk-bg', 0, 0, 532, 182, { fill: TINT, radius: 12 }),
          panel('tk-stub', 0, 0, 150, 182, { fill: ACCENT, radius: 12 }),
          text('tk-stub-l', 'بلیط ورود', 10, 12, 130, 12, {
            fontSize: 8,
            color: rgb(255, 255, 255, 0.85),
            align: 'center',
          }),
          qr('tk-qr', 45, 28, 60, 60, 'ticket.code'),
          text('tk-seat-l', 'صندلی', 10, 96, 130, 11, {
            fontSize: 7,
            color: rgb(255, 255, 255, 0.8),
            align: 'center',
          }),
          fieldEl('tk-seat', 'ticket.seat', 10, 108, 130, 20, {
            fontSize: 15,
            fontWeight: 'bold',
            color: PAPER,
            align: 'center',
          }),
          fieldEl('tk-code', 'ticket.code', 10, 134, 130, 12, {
            fontSize: 7,
            color: rgb(255, 255, 255, 0.75),
            align: 'center',
          }),
          vline('tk-cut', 150, 10, 162, PAPER, 2),

          fieldEl('tk-ev', 'event.name', 164, 12, 368, 26, { fontSize: 17, fontWeight: 'bold' }),
          fieldEl('tk-sub', 'event.subtitle', 164, 40, 368, 14, { fontSize: 9, color: MUTED }),
          hline('tk-ln', 164, 60, 368, HAIR, 1),

          text('tk-d-l', 'تاریخ', 164, 70, 88, 11, { fontSize: 7.5, color: MUTED }),
          fieldEl('tk-d', 'event.date', 164, 82, 88, 15, { fontSize: 10, fontWeight: 'bold' }),
          text('tk-t-l', 'ساعت', 256, 70, 88, 11, { fontSize: 7.5, color: MUTED }),
          fieldEl('tk-t', 'event.time', 256, 82, 88, 15, { fontSize: 10, fontWeight: 'bold' }),
          text('tk-v-l', 'سالن', 348, 70, 88, 11, { fontSize: 7.5, color: MUTED }),
          fieldEl('tk-v', 'event.venue', 348, 82, 88, 15, { fontSize: 10, fontWeight: 'bold' }),
          text('tk-g-l', 'درِ ورودی', 440, 70, 92, 11, { fontSize: 7.5, color: MUTED }),
          fieldEl('tk-g', 'event.gate', 440, 82, 92, 15, { fontSize: 10, fontWeight: 'bold' }),

          hline('tk-ln2', 164, 106, 368, HAIR, 1),
          text('tk-p-l', 'بهای بلیط (ریال)', 164, 116, 120, 11, { fontSize: 7.5, color: MUTED }),
          fieldEl('tk-p', 'ticket.price', 164, 130, 120, 20, {
            fontSize: 14,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          barcode('tk-bc', 300, 114, 232, 46, 'ticket.code', true),
          text(
            'tk-note',
            'این بلیط تنها یک‌بار قابل استفاده است — لطفاً کد QR را هنگام ورود ارائه دهید.',
            164,
            164,
            368,
            12,
            { fontSize: 7, color: MUTED },
          ),
        ]),
      },
    ],
  );
  var ticketData = {
    event: {
      name: 'کنسرت ارکستر ملی ایران',
      subtitle: 'شب‌های موسیقی سنتی — اجرای ویژهٔ تابستان',
      date: '۱۴۰۵/۰۵/۱۲',
      time: '۲۱:۰۰',
      venue: 'تالار وحدت',
      gate: 'درِ شمالی — B',
    },
    ticket: { code: 'TKT-1405-88214', seat: 'ردیف ۷ / ۱۴', price: 4500000 },
  };

  // --- ۱۷) داشبورد مدیریتی --------------------------------------------------------
  var dashboard = baseTemplate(
    'داشبورد مدیریتی',
    page({ orientation: 'landscape' }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 520 },
        elements: flat([
          text('db-title', 'داشبورد عملکرد فروش', 0, 0, 420, 26, {
            fontSize: 19,
            fontWeight: 'bold',
          }),
          fieldEl('db-sub', 'report.subtitle', 0, 28, 420, 14, { fontSize: 9, color: MUTED }),
          fieldEl('db-period', 'report.period', 460, 2, 309, 18, {
            fontSize: 11,
            fontWeight: 'bold',
            color: ACCENT,
            align: 'end',
          }),
          fieldEl('db-owner', 'report.owner', 460, 24, 309, 13, {
            fontSize: 8.5,
            color: MUTED,
            align: 'end',
          }),
          hline('db-ln', 0, 50, 769, ACCENT, 2),

          // ---- کارت‌های شاخص ----
          panel('db-k1', 0, 64, 180, 76, { fill: TINT, radius: 10 }),
          text('db-k1-l', 'درآمد کل (م.ریال)', 12, 74, 156, 12, { fontSize: 8, color: MUTED }),
          fieldEl('db-k1-v', 'sum(months, revenue)', 12, 90, 156, 26, {
            fontSize: 20,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          fieldEl('db-k1-d', 'kpi.revenueDelta', 12, 118, 156, 13, { fontSize: 8, color: MUTED }),

          panel('db-k2', 196, 64, 180, 76, { fill: TINT, radius: 10 }),
          text('db-k2-l', 'تعداد سفارش', 208, 74, 156, 12, { fontSize: 8, color: MUTED }),
          fieldEl('db-k2-v', 'sum(months, orders)', 208, 90, 156, 26, {
            fontSize: 20,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          fieldEl('db-k2-d', 'kpi.ordersDelta', 208, 118, 156, 13, { fontSize: 8, color: MUTED }),

          panel('db-k3', 392, 64, 180, 76, { fill: TINT, radius: 10 }),
          text('db-k3-l', 'میانگین سبد (م.ریال)', 404, 74, 156, 12, { fontSize: 8, color: MUTED }),
          fieldEl(
            'db-k3-v',
            'round(sum(months, revenue) / sum(months, orders), 1)',
            404,
            90,
            156,
            26,
            {
              fontSize: 20,
              fontWeight: 'bold',
              color: ACCENT,
            },
          ),
          fieldEl('db-k3-d', 'kpi.basketDelta', 404, 118, 156, 13, { fontSize: 8, color: MUTED }),

          panel('db-k4', 588, 64, 181, 76, { fill: TINT, radius: 10 }),
          text('db-k4-l', 'نرخ تحقق هدف', 600, 74, 157, 12, { fontSize: 8, color: MUTED }),
          fieldEl(
            'db-k4-v',
            "round(sum(months, revenue) / sum(months, target) * 100) + '٪'",
            600,
            90,
            157,
            26,
            { fontSize: 20, fontWeight: 'bold', color: ACCENT },
          ),
          fieldEl('db-k4-d', 'kpi.targetNote', 600, 118, 157, 13, { fontSize: 8, color: MUTED }),

          // ---- نمودارها ----
          text('db-c1-h', 'روند درآمد در برابر هدف', 0, 156, 260, 15, {
            fontSize: 10,
            fontWeight: 'bold',
          }),
          panel('db-c1-bg', 0, 174, 380, 160, { fill: rgb(248, 250, 252), radius: 10 }),
          // combo: درآمد as columns with the هدف line overlaid on the same scale
          {
            id: 'db-c1',
            type: 'chart',
            chartKind: 'combo',
            dataset: 'months',
            bounds: { x: 10, y: 184, width: 360, height: 140 },
            zIndex: 1,
            categories: { source: 'month' },
            series: [
              { name: 'درآمد', values: { source: 'revenue' }, kind: 'column' },
              { name: 'هدف', values: { source: 'target' }, kind: 'line' },
            ],
            showLegend: true,
          },

          text('db-c2-h', 'سهم کانال‌های فروش', 400, 156, 240, 15, {
            fontSize: 10,
            fontWeight: 'bold',
          }),
          panel('db-c2-bg', 400, 174, 369, 160, { fill: rgb(248, 250, 252), radius: 10 }),
          {
            id: 'db-c2',
            type: 'chart',
            chartKind: 'donut',
            dataset: 'channels',
            bounds: { x: 410, y: 184, width: 349, height: 140 },
            zIndex: 1,
            categories: { source: 'channel' },
            series: [{ name: 'سهم', values: { source: 'share' } }],
            showLegend: true,
          },

          // ---- جدول ----
          text('db-t-h', 'پرفروش‌ترین محصولات', 0, 348, 300, 15, {
            fontSize: 10,
            fontWeight: 'bold',
          }),
          {
            id: 'db-t',
            type: 'table',
            bounds: { x: 0, y: 368, width: 769, height: 130 },
            zIndex: 1,
            dataset: 'products',
            rowStripeStyleId: 'cell',
            repeatHeader: true,
            columns: [
              col('dp-i', 7, 'رتبه', '$index + 1'),
              col('dp-n', 33, 'محصول', 'name'),
              col('dp-c', 18, 'دسته', 'category'),
              col('dp-u', 14, 'تعداد', 'units', 'sum'),
              col('dp-r', 16, 'درآمد (م.ریال)', 'revenue', 'sum'),
              col('dp-g', 12, 'رشد', 'growth'),
            ],
          },
        ]),
      },
    ],
    {
      datasets: [
        { name: 'months', source: { kind: 'path', path: 'months' } },
        { name: 'channels', source: { kind: 'path', path: 'channels' } },
        { name: 'products', source: { kind: 'path', path: 'products' } },
      ],
    },
  );
  var dashboardData = {
    report: {
      subtitle: 'عملکرد شش‌ماههٔ نخست به تفکیک کانال و محصول',
      period: 'فروردین — شهریور ۱۴۰۵',
      owner: 'تهیه‌شده توسط واحد تحلیل کسب‌وکار',
    },
    kpi: {
      revenueDelta: '‎+۱۸٪ نسبت به دورهٔ پیشین',
      ordersDelta: '‎+۱۲٪ نسبت به دورهٔ پیشین',
      basketDelta: '‎+۵٪ نسبت به دورهٔ پیشین',
      targetNote: 'هدف دوره: ۳٬۵۵۰ میلیون ریال',
    },
    months: [
      { month: 'فروردین', revenue: 420, target: 400, orders: 118 },
      { month: 'اردیبهشت', revenue: 610, target: 500, orders: 164 },
      { month: 'خرداد', revenue: 380, target: 450, orders: 102 },
      { month: 'تیر', revenue: 840, target: 700, orders: 219 },
      { month: 'مرداد', revenue: 720, target: 700, orders: 188 },
      { month: 'شهریور', revenue: 905, target: 800, orders: 241 },
    ],
    channels: [
      { channel: 'فروشگاه اینترنتی', share: 46 },
      { channel: 'نمایندگی‌ها', share: 27 },
      { channel: 'فروش سازمانی', share: 18 },
      { channel: 'بازارگاه‌ها', share: 9 },
    ],
    products: [
      {
        name: 'لپ‌تاپ ۱۴ اینچ سری X',
        category: 'رایانه',
        units: 312,
        revenue: 1240,
        growth: '‎+۲۴٪',
      },
      { name: 'مانیتور ۲۴ اینچ', category: 'جانبی', units: 486, revenue: 690, growth: '‎+۱۱٪' },
      { name: 'هدفون بی‌سیم X200', category: 'صوتی', units: 731, revenue: 540, growth: '‎+۳۸٪' },
      { name: 'کیبورد مکانیکی', category: 'جانبی', units: 398, revenue: 310, growth: '‎−۴٪' },
      { name: 'هاب USB-C', category: 'جانبی', units: 902, revenue: 195, growth: '‎+۷٪' },
    ],
  };

  // --- ۱۸) کارت گارانتی ------------------------------------------------------------
  var warranty = baseTemplate(
    'کارت گارانتی',
    page({
      size: { width: 350, height: 210 },
      orientation: 'landscape',
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 182 },
        elements: flat([
          panel('wr-hd', 0, 0, 322, 46, { fill: ACCENT, radius: 8 }),
          text('wr-title', 'کارت گارانتی', 12, 8, 190, 18, {
            fontSize: 13,
            fontWeight: 'bold',
            color: PAPER,
          }),
          fieldEl('wr-brand', 'brand.name', 12, 28, 190, 12, {
            fontSize: 8,
            color: rgb(255, 255, 255, 0.85),
          }),
          fieldEl('wr-mo', "warranty.months + ' ماه'", 210, 8, 100, 20, {
            fontSize: 14,
            fontWeight: 'bold',
            color: PAPER,
            align: 'end',
          }),
          text('wr-mo-l', 'مدت ضمانت', 210, 30, 100, 11, {
            fontSize: 7,
            color: rgb(255, 255, 255, 0.8),
            align: 'end',
          }),

          pair('wr-p', 'محصول', 'product.name', 0, 60, 322, 52, {
            fontSize: 10,
            fontWeight: 'bold',
          }),
          pair('wr-m', 'مدل', 'product.model', 0, 80, 160, 52),
          pair('wr-s', 'شمارهٔ سریال', 'product.serial', 170, 80, 152, 66),
          pair('wr-d', 'تاریخ خرید', 'warranty.purchasedAt', 0, 100, 160, 52),
          pair('wr-x', 'اعتبار تا', 'warranty.expiresAt', 170, 100, 152, 66, {
            fontWeight: 'bold',
            color: ACCENT,
          }),

          barcode('wr-bc', 0, 118, 170, 38, 'product.serial', true),
          qr('wr-qr', 264, 114, 58, 58, 'warranty.verifyUrl'),
          text('wr-qr-l', 'استعلام آنلاین', 244, 173, 78, 9, {
            fontSize: 6,
            color: MUTED,
            align: 'center',
          }),
          text(
            'wr-terms',
            'ضمانت شامل نقص فنی و ایراد قطعات است. آسیب فیزیکی، نفوذ مایعات و باز شدن دستگاه توسط اشخاص غیرمجاز، گارانتی را باطل می‌کند.',
            0,
            160,
            230,
            22,
            { fontSize: 6.5, color: MUTED, lineHeight: 1.5 },
          ),
        ]),
      },
    ],
  );
  var warrantyData = {
    brand: { name: 'گروه صنعتی پارس‌الکترونیک' },
    product: { name: 'هدفون بی‌سیم مدل X200', model: 'PX-X200-BK', serial: 'SN88412007' },
    warranty: {
      months: 18,
      purchasedAt: '۱۴۰۵/۰۴/۲۲',
      expiresAt: '۱۴۰۶/۱۰/۲۲',
      verifyUrl: 'https://pars-electronic.ir/warranty/SN88412007',
    },
  };

  // --- ۱۹) برچسب ارسال مرسوله -------------------------------------------------------
  var shipping = baseTemplate(
    'برچسب ارسال',
    page({
      size: { width: 283, height: 425 },
      margins: { top: 12, right: 12, bottom: 12, left: 12 },
    }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 401 },
        elements: flat([
          panel('sh-hd', 0, 0, 259, 42, { fill: ACCENT, radius: 6 }),
          text('sh-title', 'برچسب ارسال', 8, 6, 150, 15, {
            fontSize: 11,
            fontWeight: 'bold',
            color: PAPER,
          }),
          fieldEl('sh-carrier', 'carrier.name', 8, 24, 150, 12, {
            fontSize: 8,
            color: rgb(255, 255, 255, 0.85),
          }),
          fieldEl('sh-svc', 'shipment.service', 160, 12, 91, 20, {
            fontSize: 11,
            fontWeight: 'bold',
            color: PAPER,
            align: 'end',
          }),

          panel('sh-fr', 0, 52, 259, 56, { border: HAIR, radius: 6 }),
          text('sh-fr-l', 'فرستنده', 8, 58, 100, 11, { fontSize: 7, color: MUTED }),
          fieldEl('sh-fr-n', 'from.name', 8, 70, 243, 14, { fontSize: 9, fontWeight: 'bold' }),
          fieldEl('sh-fr-a', 'from.address', 8, 86, 243, 18, {
            fontSize: 7.5,
            color: MUTED,
            lineHeight: 1.5,
          }),

          panel('sh-to', 0, 116, 259, 92, {
            fill: rgb(248, 250, 252),
            border: ACCENT,
            borderWidth: 1.2,
            radius: 6,
          }),
          text('sh-to-l', 'گیرنده', 8, 122, 100, 11, { fontSize: 7.5, color: MUTED }),
          fieldEl('sh-to-n', 'to.name', 8, 135, 243, 20, { fontSize: 13, fontWeight: 'bold' }),
          fieldEl('sh-to-a', 'to.address', 8, 157, 243, 28, { fontSize: 8.5, lineHeight: 1.6 }),
          fieldEl('sh-to-p', 'to.phone', 8, 188, 243, 13, { fontSize: 8.5, fontWeight: 'bold' }),

          text('sh-bc-l', 'کد رهگیری', 0, 214, 259, 11, { fontSize: 7, color: MUTED }),
          barcode('sh-bc', 0, 228, 259, 68, 'shipment.tracking', true),

          panel('sh-m1', 0, 304, 83, 44, { fill: TINT, radius: 6 }),
          text('sh-m1-l', 'وزن', 8, 310, 67, 11, { fontSize: 7, color: MUTED }),
          fieldEl('sh-m1', "shipment.weight + ' kg'", 8, 323, 67, 18, {
            fontSize: 12,
            fontWeight: 'bold',
          }),
          panel('sh-m2', 88, 304, 83, 44, { fill: TINT, radius: 6 }),
          text('sh-m2-l', 'تعداد بسته', 96, 310, 67, 11, { fontSize: 7, color: MUTED }),
          fieldEl('sh-m2', 'shipment.pieces', 96, 323, 67, 18, {
            fontSize: 12,
            fontWeight: 'bold',
          }),
          panel('sh-m3', 176, 304, 83, 44, { fill: TINT, radius: 6 }),
          text('sh-m3-l', 'پس‌کرایه (ریال)', 184, 310, 67, 11, { fontSize: 7, color: MUTED }),
          fieldEl('sh-m3', 'shipment.cod', 184, 323, 67, 18, {
            fontSize: 11,
            fontWeight: 'bold',
            color: ACCENT,
          }),

          qr('sh-qr', 0, 355, 46, 46, 'shipment.trackUrl'),
          text('sh-note-l', 'پیگیری مرسوله', 54, 355, 205, 12, {
            fontSize: 8,
            fontWeight: 'bold',
          }),
          text(
            'sh-note',
            'برای مشاهدهٔ وضعیت لحظه‌ای، کد QR را اسکن کنید. تحویل تنها با ارائهٔ کارت شناسایی گیرنده انجام می‌شود.',
            54,
            369,
            205,
            32,
            { fontSize: 7, color: MUTED, lineHeight: 1.6 },
          ),
        ]),
      },
    ],
  );
  var shippingData = {
    carrier: { name: 'پست پیشتاز ایران' },
    shipment: {
      service: 'اکسپرس',
      tracking: 'IR140588412007',
      weight: 2.4,
      pieces: 3,
      cod: '۱٬۲۵۰٬۰۰۰',
      trackUrl: 'https://tracking.post.ir/IR140588412007',
    },
    from: {
      name: 'فروشگاه پارس — انبار مرکزی',
      address: 'تهران، خیابان ولیعصر، بالاتر از میدان ونک، پلاک ۲۵۴۰ — کدپستی ۱۹۶۹۶۳۳۱۱۱',
    },
    to: {
      name: 'فروشگاه مرکزی کوروش',
      address: 'اصفهان، خیابان چهارباغ بالا، مجتمع تجاری کوثر، واحد ۱۲ — کدپستی ۸۱۷۳۶۵۴۳۲۱',
      phone: '۰۹۱۳ ۲۲۴ ۵۵۶۷',
    },
  };

  // --- ۲۰) دعوت‌نامه ---------------------------------------------------------------
  var invitation = baseTemplate(
    'دعوت‌نامه',
    page({
      size: { width: 595, height: 420 },
      orientation: 'landscape',
      margins: { top: 28, right: 28, bottom: 28, left: 28 },
    }),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 364 },
        elements: flat([
          panel('iv-fr', 0, 0, 539, 364, { border: ACCENT, borderWidth: 2, radius: 14 }),
          panel('iv-fr2', 7, 7, 525, 350, { border: HAIR, borderWidth: 0.8, radius: 10 }),
          ellipse('iv-o1', 18, 18, 76, 76, { fill: TINT }),
          ellipse('iv-o2', 445, 270, 76, 76, { fill: TINT }),

          text('iv-kicker', 'با افتخار دعوت می‌کنیم', 0, 40, 539, 14, {
            fontSize: 9,
            color: MUTED,
            align: 'center',
            letterSpacing: 1,
          }),
          text('iv-title', 'دعوت‌نامه', 0, 58, 539, 38, {
            fontSize: 27,
            fontWeight: 'bold',
            color: ACCENT,
            align: 'center',
          }),
          hline('iv-rule', 220, 102, 99, ACCENT, 1.5),

          text('iv-lead', 'جناب آقای / سرکار خانم', 0, 118, 539, 15, {
            fontSize: 9.5,
            color: MUTED,
            align: 'center',
          }),
          fieldEl('iv-guest', 'guest.name', 0, 138, 539, 30, {
            fontSize: 20,
            fontWeight: 'bold',
            align: 'center',
          }),
          fieldEl(
            'iv-body',
            "'حضور شما در ' + event.title + ' مایهٔ افتخار ماست.'",
            0,
            176,
            539,
            18,
            { fontSize: 11, align: 'center' },
          ),

          panel('iv-c1', 0, 210, 165, 58, { fill: rgb(248, 250, 252), radius: 8 }),
          text('iv-c1-l', 'تاریخ', 0, 218, 165, 11, {
            fontSize: 7.5,
            color: MUTED,
            align: 'center',
          }),
          fieldEl('iv-c1', 'event.date', 0, 232, 165, 20, {
            fontSize: 12,
            fontWeight: 'bold',
            align: 'center',
          }),
          panel('iv-c2', 187, 210, 165, 58, { fill: rgb(248, 250, 252), radius: 8 }),
          text('iv-c2-l', 'ساعت', 187, 218, 165, 11, {
            fontSize: 7.5,
            color: MUTED,
            align: 'center',
          }),
          fieldEl('iv-c2', 'event.time', 187, 232, 165, 20, {
            fontSize: 12,
            fontWeight: 'bold',
            align: 'center',
          }),
          panel('iv-c3', 374, 210, 165, 58, { fill: rgb(248, 250, 252), radius: 8 }),
          text('iv-c3-l', 'مکان', 374, 218, 165, 11, {
            fontSize: 7.5,
            color: MUTED,
            align: 'center',
          }),
          fieldEl('iv-c3', 'event.venue', 374, 232, 165, 20, {
            fontSize: 12,
            fontWeight: 'bold',
            align: 'center',
          }),

          qr('iv-qr', 240, 284, 58, 58, 'event.rsvpUrl'),
          text('iv-qr-l', 'تأیید حضور', 220, 344, 99, 12, {
            fontSize: 7.5,
            color: MUTED,
            align: 'center',
          }),
          fieldEl('iv-host', 'event.host', 20, 336, 180, 14, { fontSize: 8, color: MUTED }),
        ]),
      },
    ],
  );
  var invitationData = {
    guest: { name: 'دکتر سارا محمدی' },
    event: {
      title: 'آیین رونمایی از محصول جدید',
      date: '۱۴۰۵/۰۶/۰۳',
      time: '۱۸:۰۰',
      venue: 'هتل اسپیناس پالاس',
      host: 'میزبان: شرکت فناوری نوآوران',
      rsvpUrl: 'https://novaran.ir/rsvp/1405-06-03',
    },
  };

  // --- ۲۱) چک‌لیست بازرسی ------------------------------------------------------------
  var checklist = baseTemplate(
    'چک‌لیست بازرسی',
    page(),
    [
      {
        id: 'main',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 740 },
        elements: flat([
          text('ck-title', 'چک‌لیست بازرسی', 0, 0, 300, 26, { fontSize: 18, fontWeight: 'bold' }),
          fieldEl('ck-site', 'inspection.site', 0, 28, 300, 14, { fontSize: 9, color: MUTED }),
          pair('ck-i', 'بازرس', 'inspection.inspector', 330, 4, 193, 46, {
            align: 'end',
            fontWeight: 'bold',
          }),
          pair('ck-d', 'تاریخ', 'inspection.date', 330, 22, 193, 46, { align: 'end' }),
          pair('ck-c', 'کد فرم', 'inspection.code', 330, 40, 193, 46, { align: 'end' }),
          hline('ck-ln', 0, 62, 523, ACCENT, 2),

          {
            id: 'ck-list',
            type: 'list',
            dataset: 'checks',
            bounds: { x: 0, y: 78, width: 523, height: 340 },
            zIndex: 1,
            itemHeight: 34,
            gap: 5,
            itemTemplate: [
              panel('ci-bg', 0, 0, 523, 34, { fill: rgb(248, 250, 252), radius: 6 }),
              panel('ci-box', 10, 9, 16, 16, { border: HAIR, borderWidth: 1, radius: 4 }),
              {
                id: 'ci-on',
                type: 'rectangle',
                bounds: { x: 13, y: 12, width: 10, height: 10 },
                zIndex: 1,
                box: { fill: { color: ACCENT }, border: { radius: 2 } },
                visibleWhen: { source: 'done' },
              },
              fieldEl('ci-i', '$index + 1', 34, 11, 18, 12, { fontSize: 8, color: MUTED }),
              fieldEl('ci-t', 'title', 56, 5, 300, 14, { fontSize: 9.5, fontWeight: 'bold' }),
              fieldEl('ci-n', 'note', 56, 19, 300, 11, { fontSize: 7.5, color: MUTED }),
              fieldEl('ci-s', 'status', 366, 11, 147, 13, {
                fontSize: 8.5,
                color: ACCENT,
                align: 'end',
              }),
            ],
          },

          panel('ck-sum', 0, 440, 523, 56, { fill: TINT, radius: 10 }),
          text('ck-sum-l', 'جمع‌بندی بازرسی', 14, 450, 200, 13, {
            fontSize: 9,
            color: MUTED,
          }),
          fieldEl('ck-sum-v', "'مجموع بندهای بررسی‌شده: ' + len(checks)", 14, 466, 250, 18, {
            fontSize: 12,
            fontWeight: 'bold',
            color: ACCENT,
          }),
          fieldEl('ck-verdict', 'inspection.verdict', 280, 462, 229, 24, {
            fontSize: 13,
            fontWeight: 'bold',
            align: 'end',
          }),

          text('ck-note-l', 'توضیحات بازرس', 0, 512, 200, 13, { fontSize: 9, color: MUTED }),
          panel('ck-note', 0, 528, 523, 60, { border: HAIR, radius: 8 }),
          fieldEl('ck-note-v', 'inspection.notes', 10, 536, 503, 44, {
            fontSize: 8.5,
            lineHeight: 1.7,
          }),

          hline('ck-s1', 40, 640, 180, HAIR, 1),
          text('ck-s1-l', 'امضای بازرس', 40, 648, 180, 13, { fontSize: 9, align: 'center' }),
          hline('ck-s2', 300, 640, 180, HAIR, 1),
          text('ck-s2-l', 'امضای مسئول واحد', 300, 648, 180, 13, {
            fontSize: 9,
            align: 'center',
          }),
        ]),
      },
    ],
    { datasets: [{ name: 'checks', source: { kind: 'path', path: 'checks' } }] },
  );
  var checklistData = {
    inspection: {
      site: 'انبار مرکزی تهران — سالن شمارهٔ ۲',
      inspector: 'مهدی رستمی',
      date: '۱۴۰۵/۰۴/۲۸',
      code: 'INS-1405-0142',
      verdict: 'نتیجه: قابل قبول با اصلاحات',
      notes:
        'دو مورد جزئی در چیدمان کالاهای سنگین مشاهده شد که تا پایان هفته باید اصلاح شود. سایر بندها منطبق با دستورالعمل ایمنی انبار است.',
    },
    checks: [
      {
        title: 'سلامت کپسول‌های اطفای حریق',
        note: 'تاریخ شارژ و پلمب',
        done: true,
        status: 'تأیید شد',
      },
      {
        title: 'روشنایی اضطراری مسیرهای خروج',
        note: 'آزمون قطع برق',
        done: true,
        status: 'تأیید شد',
      },
      {
        title: 'علائم ایمنی و تابلوهای هشدار',
        note: 'خوانایی و نصب صحیح',
        done: true,
        status: 'تأیید شد',
      },
      {
        title: 'چیدمان کالاهای سنگین در قفسه',
        note: 'رعایت سقف وزن مجاز',
        done: false,
        status: 'نیازمند اصلاح',
      },
      {
        title: 'وضعیت لیفتراک و گواهی سرویس',
        note: 'ساعت کارکرد و روغن‌کاری',
        done: true,
        status: 'تأیید شد',
      },
      {
        title: 'دمای انبار سردخانه‌ای',
        note: 'ثبت در بازه ۲ تا ۸ درجه',
        done: true,
        status: 'تأیید شد',
      },
      {
        title: 'تجهیزات حفاظت فردی کارکنان',
        note: 'کلاه، دستکش، کفش ایمنی',
        done: false,
        status: 'کمبود موجودی',
      },
      {
        title: 'مسیرهای تخلیه و درهای اضطراری',
        note: 'بدون انسداد',
        done: true,
        status: 'تأیید شد',
      },
      {
        title: 'دفترچهٔ ثبت ورود و خروج کالا',
        note: 'تطابق با سامانه',
        done: true,
        status: 'تأیید شد',
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // پالت‌های رنگی: هر پالت فقط دو توکن ACCENT/TINT را جابه‌جا می‌کند.
  // ---------------------------------------------------------------------------
  var THEMES = [
    {
      id: 'indigo',
      name: 'نیلی',
      accent: rgb(37, 99, 235),
      tint: rgb(219, 234, 254),
      css: '#2563eb',
    },
    {
      id: 'emerald',
      name: 'زمردی',
      accent: rgb(5, 150, 105),
      tint: rgb(209, 250, 229),
      css: '#059669',
    },
    {
      id: 'violet',
      name: 'بنفش',
      accent: rgb(124, 58, 237),
      tint: rgb(237, 233, 254),
      css: '#7c3aed',
    },
    {
      id: 'amber',
      name: 'کهربایی',
      accent: rgb(180, 83, 9),
      tint: rgb(254, 243, 199),
      css: '#b45309',
    },
    { id: 'rose', name: 'گلی', accent: rgb(225, 29, 72), tint: rgb(255, 228, 230), css: '#e11d48' },
    {
      id: 'graphite',
      name: 'گرافیتی',
      accent: rgb(51, 65, 85),
      tint: rgb(226, 232, 240),
      css: '#334155',
    },
  ];

  function isColor(v, ref) {
    return (
      v &&
      typeof v === 'object' &&
      v.space === 'rgb' &&
      v.r === ref.r &&
      v.g === ref.g &&
      v.b === ref.b
    );
  }
  /**
   * Deep-clone `node`, swapping the two brand tokens for the theme's. Alpha is
   * carried over, so translucent whites-on-accent keep their transparency.
   */
  function recolor(node, theme) {
    if (node === null || typeof node !== 'object') return node;
    if (Object.prototype.toString.call(node) === '[object Array]') {
      return node.map(function (item) {
        return recolor(item, theme);
      });
    }
    var swap = isColor(node, ACCENT) ? theme.accent : isColor(node, TINT) ? theme.tint : null;
    if (swap) {
      var c = { space: 'rgb', r: swap.r, g: swap.g, b: swap.b };
      if (node.a !== undefined) c.a = node.a;
      return c;
    }
    var out = {};
    Object.keys(node).forEach(function (k) {
      out[k] = recolor(node[k], theme);
    });
    return out;
  }

  /** Public: a themed deep copy of a template (id unknown → plain deep copy). */
  function themeTemplate(template, themeId) {
    var theme = null;
    THEMES.forEach(function (t) {
      if (t.id === themeId) theme = t;
    });
    if (!theme || theme.id === 'indigo') return JSON.parse(JSON.stringify(template));
    return recolor(template, theme);
  }

  window.PDFSTUDIO_THEMES = THEMES;
  window.PDFSTUDIO_THEME_TEMPLATE = themeTemplate;
  window.PDFSTUDIO_TEMPLATE_CATEGORIES = [
    { id: 'all', name: 'همه' },
    { id: 'finance', name: 'مالی و فروش' },
    { id: 'office', name: 'اداری و منابع انسانی' },
    { id: 'report', name: 'گزارش و تحلیل' },
    { id: 'brand', name: 'بازاریابی و رویداد' },
    { id: 'label', name: 'برچسب و کارت' },
  ];

  /**
   * Gallery entries. `cat` drives the filter chips, `tags` feed the search box,
   * and `badge` is the little corner label on the card.
   */
  window.PDFSTUDIO_TEMPLATES = [
    {
      id: 'blank',
      name: 'سند خالی',
      desc: 'بوم سفید A4 — طراحی از صفر',
      cat: 'all',
      badge: 'شروع',
      tags: ['خالی', 'blank', 'a4', 'از صفر'],
      template: blank,
      data: blankData,
    },
    {
      id: 'invoice',
      name: 'فاکتور فروش',
      desc: 'جدول اقلام، جمع کل و QR شمارهٔ فاکتور',
      cat: 'finance',
      badge: 'پرکاربرد',
      tags: ['فاکتور', 'invoice', 'فروش', 'جدول', 'مالی'],
      template: invoice,
      data: invoiceData,
    },
    {
      id: 'taxInvoice',
      name: 'فاکتور رسمی مالیاتی',
      desc: 'صورتحساب استاندارد مودیان + مبلغ به حروف',
      cat: 'finance',
      badge: 'رسمی',
      tags: ['مالیات', 'مودیان', 'صورتحساب', 'tax', 'ارزش افزوده'],
      template: taxInvoice,
      data: taxInvoiceData,
    },
    {
      id: 'proforma',
      name: 'پیش‌فاکتور',
      desc: 'با تاریخ اعتبار، شرایط پرداخت و جمع کل',
      cat: 'finance',
      tags: ['پیش‌فاکتور', 'proforma', 'استعلام', 'قیمت'],
      template: proforma,
      data: proformaData,
    },
    {
      id: 'receipt',
      name: 'رسید پرداخت',
      desc: 'رول حرارتی ۸ سانتی + QR پیگیری تراکنش',
      cat: 'finance',
      tags: ['رسید', 'receipt', 'صندوق', 'حرارتی', 'پرداخت'],
      template: receipt,
      data: receiptData,
    },
    {
      id: 'payslip',
      name: 'فیش حقوقی',
      desc: 'دریافتی و کسورات، خالص پرداختی و مبلغ به حروف',
      cat: 'office',
      badge: 'تازه',
      tags: ['حقوق', 'payslip', 'دستمزد', 'منابع انسانی', 'کسورات'],
      template: payslip,
      data: payslipData,
    },
    {
      id: 'contract',
      name: 'قرارداد خدمات',
      desc: 'طرفین، مواد شماره‌دار تکرارشونده و امضاها',
      cat: 'office',
      badge: 'تازه',
      tags: ['قرارداد', 'contract', 'حقوقی', 'مواد', 'پیمانکار'],
      template: contract,
      data: contractData,
    },
    {
      id: 'letterhead',
      name: 'سربرگ نامه',
      desc: 'سربرگ اداری با شماره، تاریخ و پیوست',
      cat: 'office',
      tags: ['سربرگ', 'نامه', 'letterhead', 'اداری', 'مکاتبه'],
      template: letterhead,
      data: letterheadData,
    },
    {
      id: 'timesheet',
      name: 'گزارش کارکرد',
      desc: 'تایم‌شیت روزانه با جمع ساعت و امضا',
      cat: 'office',
      tags: ['کارکرد', 'timesheet', 'ساعت', 'پروژه'],
      template: timesheet,
      data: timesheetData,
    },
    {
      id: 'checklist',
      name: 'چک‌لیست بازرسی',
      desc: 'بندهای تیک‌خورده، جمع‌بندی و توضیحات بازرس',
      cat: 'office',
      badge: 'تازه',
      tags: ['چک‌لیست', 'checklist', 'بازرسی', 'ایمنی', 'فرم'],
      template: checklist,
      data: checklistData,
    },
    {
      id: 'resume',
      name: 'رزومهٔ حرفه‌ای',
      desc: 'ستون برند، نوار مهارت‌ها و تایم‌لاین سوابق',
      cat: 'office',
      badge: 'ویژه',
      tags: ['رزومه', 'resume', 'cv', 'شغل', 'مهارت'],
      template: resume,
      data: resumeData,
    },
    {
      id: 'dashboard',
      name: 'داشبورد مدیریتی',
      desc: 'کارت‌های شاخص، نمودار ترکیبی و دونات + جدول',
      cat: 'report',
      badge: 'ویژه',
      tags: ['داشبورد', 'dashboard', 'kpi', 'نمودار', 'تحلیل', 'مدیریتی'],
      template: dashboard,
      data: dashboardData,
    },
    {
      id: 'report',
      name: 'گزارش فروش',
      desc: 'نمودار ستونی ماهانه + جدول با جمع',
      cat: 'report',
      tags: ['گزارش', 'report', 'فروش', 'نمودار', 'ماهانه'],
      template: report,
      data: reportData,
    },
    {
      id: 'packing',
      name: 'لیست بسته‌بندی',
      desc: 'کارتن، تعداد و وزن + بارکد سفارش',
      cat: 'report',
      tags: ['بسته‌بندی', 'packing', 'انبار', 'ارسال', 'بارکد'],
      template: packing,
      data: packingData,
    },
    {
      id: 'ticket',
      name: 'بلیط رویداد',
      desc: 'ته‌بلیط جداشدنی با QR، بارکد و صندلی',
      cat: 'brand',
      badge: 'تازه',
      tags: ['بلیط', 'ticket', 'رویداد', 'کنسرت', 'qr'],
      template: ticket,
      data: ticketData,
    },
    {
      id: 'invitation',
      name: 'دعوت‌نامه',
      desc: 'کارت تشریفاتی افقی با قاب و QR تأیید حضور',
      cat: 'brand',
      badge: 'تازه',
      tags: ['دعوت', 'invitation', 'مراسم', 'رویداد', 'rsvp'],
      template: invitation,
      data: invitationData,
    },
    {
      id: 'menu',
      name: 'منوی رستوران',
      desc: 'دو بخش غذا و نوشیدنی + QR سفارش آنلاین',
      cat: 'brand',
      tags: ['منو', 'menu', 'رستوران', 'کافه', 'غذا'],
      template: menu,
      data: menuData,
    },
    {
      id: 'certificate',
      name: 'گواهی‌نامه',
      desc: 'افقی با قاب دوخطه، امضاها و QR استعلام',
      cat: 'brand',
      tags: ['گواهی', 'certificate', 'دوره', 'آموزش', 'مدرک'],
      template: certificate,
      data: certificateData,
    },
    {
      id: 'card',
      name: 'کارت ویزیت',
      desc: 'سایز استاندارد ۹×۵ با نوار برند و QR',
      cat: 'label',
      tags: ['کارت ویزیت', 'business card', 'ویزیت', 'برند'],
      template: card,
      data: cardData,
    },
    {
      id: 'shipping',
      name: 'برچسب ارسال',
      desc: 'برچسب ۱۰×۱۵ با بارکد رهگیری و کادر گیرنده',
      cat: 'label',
      badge: 'تازه',
      tags: ['ارسال', 'shipping', 'پست', 'رهگیری', 'مرسوله', 'برچسب'],
      template: shipping,
      data: shippingData,
    },
    {
      id: 'warranty',
      name: 'کارت گارانتی',
      desc: 'سریال، مدت ضمانت، بارکد و QR استعلام',
      cat: 'label',
      badge: 'تازه',
      tags: ['گارانتی', 'warranty', 'ضمانت', 'سریال', 'کارت'],
      template: warranty,
      data: warrantyData,
    },
    {
      id: 'label',
      name: 'برچسب محصول',
      desc: 'بارکد، قیمت و QR در سایز قفسه‌ای',
      cat: 'label',
      tags: ['برچسب', 'label', 'قیمت', 'بارکد', 'قفسه'],
      template: label,
      data: labelData,
    },
  ];
})();
