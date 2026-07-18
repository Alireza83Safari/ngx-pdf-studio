/* global PdfStudio, window, document */
/**
 * Visual designer built on the bundled engine (`window.PdfStudio`).
 *
 * The canvas is true WYSIWYG: the page background is the engine's own SVG
 * painting of the current template (the same `Page[]` tree the PDF is built
 * from, §7), with transparent interactive overlays on top for selection,
 * drag, and resize. Every edit goes through the engine's command-driven
 * DocumentStore (undo/redo, drag coalescing).
 *
 * Designer features (§8): full toolbox (text, field, rect, line, ellipse,
 * image, barcode, QR, chart), snap-to-grid + element-edge snapping with live
 * guides, multi-select (shift-click), zoom (buttons + Ctrl+wheel), arrow-key
 * nudge, duplicate (Ctrl+D), JSON import/export, live preview, PDF download.
 * No build step at runtime — open designer.html directly.
 */
(function () {
  'use strict';
  var P = window.PdfStudio;
  var zoom = 0.85;
  var GRID = 5;
  var SNAP_EDGE = 4;
  var uid = 1;
  var dragSeq = 0;
  var addCascade = 0;
  var clipboard = [];
  var pasteSeq = 0;
  var activeBand = 0; // which band the canvas edits (index into template.bands)
  var selected = []; // ids, last item drives the inspector
  var sampleData = {
    company: { name: 'شرکت نمونه' },
    customer: { name: 'علی رضایی' },
    invoice: { number: 'INV-1405-0042' },
    items: [
      { name: 'کالای اول', qty: 2, price: 1250000 },
      { name: 'کالای دوم', qty: 1, price: 890000 },
      { name: 'کالای سوم', qty: 5, price: 145000 },
    ],
  };

  // --- helpers -------------------------------------------------------------
  function rgb(r, g, b) {
    return { space: 'rgb', r: r, g: g, b: b };
  }
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return rgb(0, 0, 0);
    var n = parseInt(m[1], 16);
    return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  function rgbToHex(c) {
    if (!c || c.space !== 'rgb') return '#000000';
    function h(v) {
      return ('0' + Math.round(v).toString(16)).slice(-2);
    }
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }
  function base64ToBytes(b64) {
    var bin = window.atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function lastSelected() {
    return selected.length ? selected[selected.length - 1] : null;
  }
  function isSelected(id) {
    return selected.indexOf(id) !== -1;
  }

  // --- type metadata for the UI (§8) ---------------------------------------
  var FA_NAMES = {
    staticText: 'متن',
    dataField: 'فیلد داده',
    richText: 'متن غنی',
    rectangle: 'مستطیل',
    line: 'خط',
    ellipse: 'بیضی',
    image: 'تصویر',
    barcode: 'بارکد',
    qrcode: 'کد QR',
    chart: 'چارت',
    table: 'جدول',
    list: 'لیست',
    container: 'گروه',
    toc: 'فهرست مطالب',
    formField: 'فیلد فرم',
    custom: 'المان سفارشی',
    pageField: 'فیلد صفحه',
    subreport: 'زیرگزارش',
    crosstab: 'جدول محوری',
  };
  function faName(type) {
    return FA_NAMES[type] || type;
  }
  var ICON_PATHS = {
    staticText: '<path d="M4 5h12M10 5v10"/>',
    dataField:
      '<path d="M7.5 4C5.5 4 6.5 10 4 10c2.5 0 1.5 6 3.5 6"/><path d="M12.5 4c2 0 1 6 3.5 6-2.5 0-1.5 6-3.5 6"/>',
    rectangle: '<rect x="3.5" y="5" width="13" height="10" rx="1.5"/>',
    line: '<path d="M4 16 16 4"/>',
    ellipse: '<ellipse cx="10" cy="10" rx="7" ry="5"/>',
    image:
      '<rect x="3.5" y="4" width="13" height="12" rx="2"/><circle cx="8" cy="8.5" r="1.4"/><path d="m4.5 14.5 4-4 3 3 2-2 2 2"/>',
    barcode: '<path d="M4 5v10M7 5v10M9.5 5v10M13 5v10M16 5v10M11 5v6"/>',
    qrcode:
      '<rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="11.5" y="3.5" width="5" height="5" rx="1"/><rect x="3.5" y="11.5" width="5" height="5" rx="1"/><path d="M11.5 11.5h2v2h-2zM14.5 14.5h2v2h-2z"/>',
    chart: '<path d="M4 4v12h12"/><path d="M7.5 13V9M11 13V6.5M14.5 13v-3"/>',
    table: '<rect x="3.5" y="4" width="13" height="12" rx="1.5"/><path d="M3.5 8.5h13M8.5 4v12"/>',
    toc: '<path d="M4 5h9M4 10h12M4 15h7"/><circle cx="16" cy="5" r="0.8"/>',
  };
  function typeIcon(type, size) {
    var d = ICON_PATHS[type] || '<rect x="4" y="4" width="12" height="12" rx="2"/>';
    return (
      '<svg width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      d +
      '</svg>'
    );
  }

  /** Move native `title` attributes to the custom [data-tip] tooltips (§8A). */
  function upgradeTooltips(root) {
    (root || document).querySelectorAll('[title]').forEach(function (node) {
      if (node.classList && node.classList.contains('tool')) return;
      if (!node.dataset.tip) node.dataset.tip = node.getAttribute('title');
      node.removeAttribute('title');
    });
  }

  // --- toast ----------------------------------------------------------------
  var toastTimer = null;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      function () {
        el.classList.remove('show');
      },
      isError ? 5000 : 2400,
    );
  }

  // --- right-panel tabs -------------------------------------------------------
  function setTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('.tabpane').forEach(function (pane) {
      pane.classList.toggle('active', pane.dataset.pane === name);
    });
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      setTab(t.dataset.tab);
    });
  });

  // Make the bundled font available to the canvas SVG + overlays.
  if (window.VAZIRMATN_BASE64) {
    var fontCss = document.createElement('style');
    fontCss.textContent =
      "@font-face{font-family:'Vazirmatn';src:url(data:font/ttf;base64," +
      window.VAZIRMATN_BASE64 +
      ') format("truetype");}';
    document.head.appendChild(fontCss);
  }

  // --- initial template ----------------------------------------------------
  function freshTemplate() {
    return {
      schemaVersion: '1.0.0',
      metadata: { name: 'Untitled / بدون عنوان' },
      page: {
        size: 'A4',
        orientation: 'portrait',
        margins: { top: 30, right: 30, bottom: 30, left: 30 },
        direction: 'rtl',
        locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
        unit: 'pt',
      },
      styles: [],
      datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
      parameters: [],
      bands: [
        {
          id: 'main',
          type: 'reportHeader',
          height: { mode: 'fixed', value: 760 },
          elements: [
            {
              id: 'el-title',
              type: 'staticText',
              bounds: { x: 0, y: 0, width: 300, height: 28 },
              zIndex: 1,
              text: 'فاکتور فروش',
              typography: {
                fontFamily: 'Vazirmatn',
                fontSize: 20,
                fontWeight: 'bold',
                color: rgb(37, 99, 235),
              },
            },
            {
              id: 'el-cust',
              type: 'dataField',
              bounds: { x: 0, y: 40, width: 260, height: 18 },
              zIndex: 1,
              value: { source: 'customer.name' },
              typography: { fontFamily: 'Vazirmatn', fontSize: 12 },
            },
          ],
        },
      ],
      resources: { fonts: [], images: [] },
    };
  }

  /** A completely empty page — the from-scratch starting point (§8A-B). */
  function blankTemplate() {
    var t = freshTemplate();
    t.metadata = { name: 'سند خالی' };
    t.bands[0].elements = [];
    return t;
  }

  var store = new P.DocumentStore(freshTemplate());

  /** Rename the document (undoable). */
  function renameCmd(name, prev) {
    return {
      type: 'rename',
      apply: function (t) {
        return Object.assign({}, t, { metadata: Object.assign({}, t.metadata, { name: name }) });
      },
      invert: function () {
        return renameCmd(prev, name);
      },
    };
  }

  // --- commands ------------------------------------------------------------
  function restoreCmd(id, element) {
    return {
      type: 'restore',
      apply: function (t) {
        return P.updateElement(t, id, function () {
          return element;
        });
      },
      invert: function (t) {
        var loc = P.findElement(t, id);
        return restoreCmd(id, loc ? loc.element : element);
      },
    };
  }
  function updateCmd(id, updater) {
    var loc = P.findElement(store.getState(), id);
    var before = loc ? loc.element : null;
    return {
      type: 'update',
      apply: function (t) {
        return P.updateElement(t, id, function (e) {
          return updater(Object.assign({}, e));
        });
      },
      invert: function () {
        return before ? restoreCmd(id, before) : P.NO_OP;
      },
    };
  }
  function update(id, updater) {
    if (!P.findElement(store.getState(), id)) return;
    store.dispatch(updateCmd(id, updater));
  }
  /** Apply the same mutation to every selected element in one undo step. */
  function updateSelected(updater) {
    var ids = selected.length ? selected : [lastSelected()];
    var cmds = ids
      .filter(function (sid) {
        return sid && P.findElement(store.getState(), sid);
      })
      .map(function (sid) {
        return updateCmd(sid, updater);
      });
    if (cmds.length) store.dispatch(P.composite(cmds));
  }
  /** Move several elements by (dx, dy) as one undoable command. */
  function moveManyCmd(ids, dx, dy) {
    return {
      type: 'moveMany',
      apply: function (t) {
        return ids.reduce(function (acc, id) {
          return P.updateElement(acc, id, function (e) {
            var b = e.bounds;
            return Object.assign({}, e, {
              bounds: { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height },
            });
          });
        }, t);
      },
      invert: function () {
        return moveManyCmd(ids, -dx, -dy);
      },
    };
  }
  /** Set several elements' bounds at once (align/distribute), undoable. */
  function boundsManyCmd(next, prev) {
    return {
      type: 'boundsMany',
      apply: function (t) {
        return Object.keys(next).reduce(function (acc, id) {
          return P.updateElement(acc, id, function (e) {
            return Object.assign({}, e, { bounds: next[id] });
          });
        }, t);
      },
      invert: function () {
        return boundsManyCmd(prev, next);
      },
    };
  }

  function selectedBounds() {
    var t = store.getState();
    var out = {};
    selected.forEach(function (id) {
      var loc = P.findElement(t, id);
      if (loc) out[id] = Object.assign({}, loc.element.bounds);
    });
    return out;
  }

  /** Align the selection: left|centerH|right|top|middle|bottom. */
  function alignSelected(kind) {
    var prev = selectedBounds();
    var ids = Object.keys(prev);
    if (ids.length < 2) return;
    var xs = ids.map(function (id) {
      return prev[id];
    });
    var minX = Math.min.apply(
      null,
      xs.map((b) => b.x),
    );
    var maxR = Math.max.apply(
      null,
      xs.map((b) => b.x + b.width),
    );
    var minY = Math.min.apply(
      null,
      xs.map((b) => b.y),
    );
    var maxB = Math.max.apply(
      null,
      xs.map((b) => b.y + b.height),
    );
    var next = {};
    ids.forEach(function (id) {
      var b = Object.assign({}, prev[id]);
      if (kind === 'left') b.x = minX;
      else if (kind === 'right') b.x = maxR - b.width;
      else if (kind === 'centerH') b.x = minX + (maxR - minX - b.width) / 2;
      else if (kind === 'top') b.y = minY;
      else if (kind === 'bottom') b.y = maxB - b.height;
      else if (kind === 'middle') b.y = minY + (maxB - minY - b.height) / 2;
      next[id] = b;
    });
    store.dispatch(boundsManyCmd(next, prev));
  }

  /** Distribute the selection evenly: h|v (needs 3+). */
  function distributeSelected(axis) {
    var prev = selectedBounds();
    var ids = Object.keys(prev);
    if (ids.length < 3) return;
    var horiz = axis === 'h';
    ids.sort(function (a, b) {
      return horiz ? prev[a].x - prev[b].x : prev[a].y - prev[b].y;
    });
    var first = prev[ids[0]];
    var last = prev[ids[ids.length - 1]];
    var span = horiz ? last.x + last.width - first.x : last.y + last.height - first.y;
    var total = ids.reduce(function (s, id) {
      return s + (horiz ? prev[id].width : prev[id].height);
    }, 0);
    var gap = (span - total) / (ids.length - 1);
    var cursor = horiz ? first.x : first.y;
    var next = {};
    ids.forEach(function (id) {
      var b = Object.assign({}, prev[id]);
      if (horiz) {
        b.x = Math.round(cursor);
        cursor += b.width + gap;
      } else {
        b.y = Math.round(cursor);
        cursor += b.height + gap;
      }
      next[id] = b;
    });
    store.dispatch(boundsManyCmd(next, prev));
  }

  /** Bring the selection above (or send below) everything else. */
  function reorderSelected(front) {
    var t = store.getState();
    var zs = getActiveBand(t).elements.map(function (e) {
      return e.zIndex || 1;
    });
    var z = front ? Math.max.apply(null, zs) + 1 : Math.min.apply(null, zs) - 1;
    var cmds = selected.map(function (id) {
      return updateCmd(id, function (e) {
        e.zIndex = z;
        return e;
      });
    });
    if (cmds.length) store.dispatch(P.composite(cmds));
  }

  var DEFAULTS = {
    staticText: function (base) {
      return Object.assign(base, {
        type: 'staticText',
        text: 'متن جدید',
        typography: { fontFamily: 'Vazirmatn', fontSize: 13 },
      });
    },
    dataField: function (base) {
      return Object.assign(base, {
        type: 'dataField',
        // bind to a field that actually exists in the current data, so it lands
        // showing a real value instead of an empty box
        value: { source: detectField() },
        typography: { fontFamily: 'Vazirmatn', fontSize: 13 },
      });
    },
    // A ready "label + value in a box": a container that paints a bordered box
    // with a caption above the bound value — the everyday invoice/form field.
    labeledField: function (base) {
      var src = detectField();
      var w = 210,
        h = 48;
      return Object.assign(base, {
        type: 'container',
        bounds: { x: base.bounds.x, y: base.bounds.y, width: w, height: h },
        box: {
          fill: { color: rgb(248, 250, 252) },
          border: { all: { width: 1, color: rgb(203, 213, 225) } },
        },
        children: [
          {
            id: 'el-' + uid++,
            type: 'staticText',
            bounds: { x: 10, y: 7, width: w - 20, height: 13 },
            zIndex: 1,
            text: labelFor(src),
            typography: { fontFamily: 'Vazirmatn', fontSize: 9, color: rgb(100, 116, 139) },
          },
          {
            id: 'el-' + uid++,
            type: 'dataField',
            bounds: { x: 10, y: 22, width: w - 20, height: 18 },
            zIndex: 2,
            value: { source: src },
            typography: {
              fontFamily: 'Vazirmatn',
              fontSize: 13,
              fontWeight: 'bold',
              color: rgb(15, 23, 42),
            },
          },
        ],
      });
    },
    rectangle: function (base) {
      return Object.assign(base, {
        type: 'rectangle',
        bounds: { x: 40, y: 80, width: 200, height: 80 },
        box: {
          fill: { color: rgb(241, 245, 249) },
          border: { all: { width: 1, color: rgb(203, 213, 225) } },
        },
      });
    },
    line: function (base) {
      return Object.assign(base, {
        type: 'line',
        bounds: { x: 40, y: 80, width: 200, height: 2 },
        stroke: { width: 1.5, color: rgb(51, 65, 85) },
      });
    },
    ellipse: function (base) {
      return Object.assign(base, {
        type: 'ellipse',
        bounds: { x: 40, y: 80, width: 120, height: 80 },
        box: {
          fill: { color: rgb(219, 234, 254) },
          border: { all: { width: 1, color: rgb(37, 99, 235) } },
        },
      });
    },
    image: function (base) {
      return Object.assign(base, {
        type: 'image',
        bounds: { x: 40, y: 80, width: 120, height: 90 },
        source: { source: "'https://placehold.co/240x180.png'" },
        fit: 'contain',
      });
    },
    barcode: function (base) {
      return Object.assign(base, {
        type: 'barcode',
        symbology: 'code128',
        value: { source: "'INV-1405'" },
        showText: true,
        bounds: { x: 40, y: 80, width: 200, height: 56 },
      });
    },
    qrcode: function (base) {
      return Object.assign(base, {
        type: 'qrcode',
        value: { source: "'https://example.com'" },
        bounds: { x: 40, y: 80, width: 80, height: 80 },
      });
    },
    chart: function (base) {
      return Object.assign(base, {
        type: 'chart',
        chartKind: 'column',
        dataset: 'items',
        categories: { source: 'name' },
        series: [{ name: 'مقدار', values: { source: 'qty * price' } }],
        bounds: { x: 40, y: 80, width: 260, height: 140 },
      });
    },
    pageField: function (base) {
      // page number / total / date — resolves inside page headers & footers
      return Object.assign(base, {
        type: 'pageField',
        field: 'page',
        bounds: { x: base.bounds.x, y: base.bounds.y, width: 120, height: 16 },
        typography: { fontFamily: 'Vazirmatn', fontSize: 10, color: rgb(100, 116, 139) },
      });
    },
    table: function (base) {
      // bind to the first array-of-objects in the sample data, one column per
      // field — so "add table" lands already wired to real data, not empty.
      var ds = detectDataset();
      return Object.assign(base, {
        type: 'table',
        dataset: ds.name,
        repeatHeader: true,
        rowStripeStyleId: 'tblCell',
        columns: ds.keys.map(function (k) {
          return {
            id: 'col-' + uid++,
            width: { kind: 'percent', value: 100 / ds.keys.length },
            header: { text: k, styleId: 'tblHead' },
            detail: { content: { source: k }, styleId: 'tblCell' },
          };
        }),
        bounds: { x: 40, y: 80, width: 360, height: 120 },
      });
    },
  };

  // Cell styles a designer-made table references. Injected into the template
  // when the first table is added — without them cells fall back to the
  // Standard-14 font and Persian text vanishes from the PDF.
  var TABLE_STYLES = [
    {
      id: 'tblCell',
      name: 'سلول جدول',
      typography: { fontFamily: 'Vazirmatn', fontSize: 10, color: rgb(15, 23, 42) },
    },
    {
      id: 'tblHead',
      name: 'سرستون جدول',
      typography: {
        fontFamily: 'Vazirmatn',
        fontSize: 10,
        fontWeight: 'bold',
        color: rgb(15, 23, 42),
      },
      box: { fill: { color: rgb(241, 245, 249) } },
    },
  ];

  function detectDataset() {
    for (var k in sampleData) {
      if (
        Object.prototype.hasOwnProperty.call(sampleData, k) &&
        Array.isArray(sampleData[k]) &&
        sampleData[k].length &&
        sampleData[k][0] &&
        typeof sampleData[k][0] === 'object'
      ) {
        return { name: k, keys: Object.keys(sampleData[k][0]).slice(0, 5) };
      }
    }
    return { name: 'items', keys: ['name', 'qty', 'price'] };
  }

  /** Resolve a dotted path against the current sample data. */
  function resolvePath(p) {
    return p.split('.').reduce(function (o, k) {
      return o == null ? o : o[k];
    }, sampleData);
  }
  /**
   * A binding that actually resolves in the current data, so a fresh dataField
   * shows a real value instead of an empty box. Tries common invoice/report
   * fields, then the first scalar leaf, then a safe fallback.
   */
  function detectField() {
    var candidates = [
      'company.name',
      'customer.name',
      'name',
      'title',
      'fullName',
      'invoice.number',
    ];
    for (var i = 0; i < candidates.length; i++) {
      var v = resolvePath(candidates[i]);
      if (v != null && v !== '') return candidates[i];
    }
    var found = null;
    (function walk(obj, path) {
      if (found || !obj || typeof obj !== 'object' || Array.isArray(obj)) return;
      Object.keys(obj).forEach(function (k) {
        if (found) return;
        var v = obj[k];
        var p = path ? path + '.' + k : k;
        if ((typeof v === 'string' && v !== '') || typeof v === 'number') found = p;
        else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p);
      });
    })(sampleData, '');
    return found || 'customer.name';
  }
  var FIELD_LABELS = {
    'company.name': 'نام شرکت',
    'company.address': 'آدرس',
    'customer.name': 'نام مشتری',
    'customer.phone': 'تلفن',
    'invoice.number': 'شماره فاکتور',
    'invoice.date': 'تاریخ',
    name: 'نام',
    title: 'عنوان',
    total: 'جمع کل',
    qty: 'تعداد',
    price: 'قیمت',
    phone: 'تلفن',
    email: 'ایمیل',
    address: 'آدرس',
    date: 'تاریخ',
  };
  /** A friendly Persian caption for a bound field path, for labeled fields. */
  function labelFor(src) {
    if (FIELD_LABELS[src]) return FIELD_LABELS[src];
    var last = String(src || '')
      .split('.')
      .pop();
    return FIELD_LABELS[last] || 'برچسب';
  }
  // A labeled field is a container whose caption is its first staticText child
  // and whose value is its first dataField child.
  function labeledLabel(el) {
    return (el.children || []).filter(function (c) {
      return c.type === 'staticText';
    })[0];
  }
  function labeledValue(el) {
    return (el.children || []).filter(function (c) {
      return c.type === 'dataField';
    })[0];
  }
  /**
   * First free position (content-left, scanning downward) for a new element, so
   * clicking a toolbox tool never drops a box on top of the title or other
   * content. Falls back to the current active band's elements for collision.
   */
  function nextSpot(w, h) {
    var els = getActiveBand(store.getState()).elements;
    var W = w || 200,
      H = h || 24,
      x = 0,
      y = 0,
      guard = 0;
    var hit = function (yy) {
      return els.some(function (e) {
        var b = e.bounds;
        return !(x + W <= b.x || x >= b.x + b.width || yy + H <= b.y || yy >= b.y + b.height);
      });
    };
    while (hit(y) && guard++ < 500) y += 8;
    return { x: x, y: Math.round(y) };
  }

  /** Add any styles whose id isn't already present; undo removes exactly those. */
  function ensureStylesCmd(newStyles) {
    return {
      type: 'ensureStyles',
      apply: function (t) {
        var have = {};
        (t.styles || []).forEach(function (s) {
          have[s.id] = true;
        });
        var add = newStyles.filter(function (s) {
          return !have[s.id];
        });
        return add.length ? Object.assign({}, t, { styles: (t.styles || []).concat(add) }) : t;
      },
      invert: function (t) {
        var have = {};
        (t.styles || []).forEach(function (s) {
          have[s.id] = true;
        });
        var addedIds = newStyles
          .filter(function (s) {
            return !have[s.id];
          })
          .map(function (s) {
            return s.id;
          });
        return {
          type: 'removeStyles',
          apply: function (t2) {
            return Object.assign({}, t2, {
              styles: (t2.styles || []).filter(function (s) {
                return addedIds.indexOf(s.id) === -1;
              }),
            });
          },
          invert: function () {
            return ensureStylesCmd(newStyles);
          },
        };
      },
    };
  }

  /** Declare a path-backed dataset by name if the template doesn't have it yet. */
  function ensureDatasetCmd(name) {
    return {
      type: 'ensureDataset',
      apply: function (t) {
        var nm = (name || '').trim();
        if (!nm || (t.datasets || []).some((d) => d.name === nm)) return t;
        return Object.assign({}, t, {
          datasets: (t.datasets || []).concat([{ name: nm, source: { kind: 'path', path: nm } }]),
        });
      },
      invert: function (t) {
        var nm = (name || '').trim();
        if (!nm || (t.datasets || []).some((d) => d.name === nm)) return P.NO_OP;
        return {
          type: 'removeDataset',
          apply: function (t2) {
            return Object.assign({}, t2, {
              datasets: (t2.datasets || []).filter((d) => d.name !== nm),
            });
          },
          invert: function () {
            return ensureDatasetCmd(name);
          },
        };
      },
    };
  }

  /** Dispatch an element add, wiring table cell styles + dataset atomically. */
  function dispatchAddElement(el) {
    var bandId = curBandId();
    if (el.type === 'table') {
      store.dispatch(
        P.composite([
          ensureStylesCmd(TABLE_STYLES),
          ensureDatasetCmd(el.dataset),
          P.addElement(bandId, el),
        ]),
      );
    } else {
      store.dispatch(P.addElement(bandId, el));
    }
  }

  function addElement(type) {
    var id = 'el-' + uid++;
    var base = { id: id, bounds: { x: 0, y: 0, width: 200, height: 24 }, zIndex: 1 };
    var make = DEFAULTS[type] || DEFAULTS.staticText;
    var el = make(base);
    // drop into the first free spot (never on top of the title or other
    // content) instead of a fixed 40,80 that overlaps whatever is already there
    var spot = nextSpot(el.bounds.width, el.bounds.height);
    el.bounds = Object.assign({}, el.bounds, { x: spot.x, y: spot.y });
    // select first: the store notifies synchronously on dispatch and the
    // subscribers read the selection when re-rendering.
    selected = [id];
    dispatchAddElement(el);
  }

  function copySelected() {
    var t = store.getState();
    var items = [];
    selected.forEach(function (id) {
      var loc = P.findElement(t, id);
      if (loc) items.push(JSON.parse(JSON.stringify(loc.element)));
    });
    if (items.length) {
      clipboard = items;
      pasteSeq = 0;
      toast(items.length + ' مورد کپی شد');
    }
  }

  function pasteClipboard() {
    if (!clipboard.length) return;
    var bandId = curBandId();
    pasteSeq += 1;
    var d = 12 * pasteSeq;
    var adds = [];
    var fresh = [];
    clipboard.forEach(function (src) {
      var copy = JSON.parse(JSON.stringify(src));
      copy.id = 'el-' + uid++;
      copy.bounds = Object.assign({}, copy.bounds, {
        x: copy.bounds.x + d,
        y: copy.bounds.y + d,
      });
      adds.push(P.addElement(bandId, copy));
      fresh.push(copy.id);
    });
    // one composite → paste is a single undo step
    store.dispatch(P.composite(adds));
    selected = fresh;
    renderCanvas();
    renderInspector();
  }

  function duplicateSelected() {
    var t = store.getState();
    var bandId = getActiveBand(t).id;
    var adds = [];
    var fresh = [];
    selected.forEach(function (id) {
      var loc = P.findElement(t, id);
      if (!loc) return;
      var copy = JSON.parse(JSON.stringify(loc.element));
      copy.id = 'el-' + uid++;
      copy.bounds = Object.assign({}, copy.bounds, {
        x: copy.bounds.x + 12,
        y: copy.bounds.y + 12,
      });
      adds.push(P.addElement(bandId, copy));
      fresh.push(copy.id);
    });
    if (adds.length) {
      // one composite → the whole duplicate is a single undo step
      store.dispatch(P.composite(adds));
      selected = fresh;
      renderCanvas();
      renderInspector();
    }
  }

  // --- canvas rendering ----------------------------------------------------
  var pageEl = document.getElementById('page');
  var pageSvgEl = document.getElementById('pageSvg');
  var marginsEl = document.getElementById('margins');
  var guideV = document.getElementById('guideV');
  var guideH = document.getElementById('guideH');

  function pageSize(t) {
    return P.resolvePageSize(t.page.size, t.page.orientation);
  }

  // Preview-values toggle (§8A): show bound sample values (default) or the
  // raw binding names on the canvas.
  var showValues = true;
  function displayTemplate(t) {
    if (showValues) return t;
    var clone = JSON.parse(JSON.stringify(t));
    clone.bands.forEach(function (band) {
      (band.elements || []).forEach(function (el) {
        if (el.type === 'dataField' && el.value) {
          el.type = 'staticText';
          el.text = '{' + el.value.source + '}';
          delete el.format;
        }
      });
    });
    return clone;
  }

  // --- bands ----------------------------------------------------------------
  // The engine supports a full band stack (header/detail/footer…); the designer
  // edits ONE band at a time. The canvas paints just the active band, isolated
  // at the top so the band-relative overlays line up; the Preview pane shows the
  // true multi-band paginated result.
  var BAND_TYPES = [
    { type: 'reportHeader', name: 'سربرگ گزارش' },
    { type: 'pageHeader', name: 'سرصفحه' },
    { type: 'detail', name: 'ردیف داده' },
    { type: 'pageFooter', name: 'پاصفحه' },
    { type: 'reportFooter', name: 'پابرگ گزارش' },
  ];
  function bandTypeName(type) {
    var m = BAND_TYPES.filter(function (b) {
      return b.type === type;
    })[0];
    return m ? m.name : type;
  }
  function clampActiveBand(t) {
    if (activeBand >= t.bands.length) activeBand = t.bands.length - 1;
    if (activeBand < 0) activeBand = 0;
    return activeBand;
  }
  function getActiveBand(t) {
    return t.bands[clampActiveBand(t)];
  }
  function curBandId() {
    return getActiveBand(store.getState()).id;
  }
  function isRowBand(band) {
    return band.type === 'detail' || band.type === 'groupHeader' || band.type === 'groupFooter';
  }
  function resolveDatasetArray(t, dsName) {
    if (!dsName) return null;
    var decl = (t.datasets || []).filter(function (d) {
      return d.name === dsName;
    })[0];
    var path = decl && decl.source && decl.source.kind === 'path' ? decl.source.path : dsName;
    var arr = path.split('.').reduce(function (o, k) {
      return o == null ? o : o[k];
    }, sampleData);
    return Array.isArray(arr) ? arr : null;
  }
  /** Data used to preview the active band: detail bands get their first row. */
  function activeBandData(t) {
    var band = getActiveBand(t);
    if (band && band.dataset) {
      var arr = resolveDatasetArray(t, band.dataset);
      if (arr && arr.length && typeof arr[0] === 'object')
        return Object.assign({}, sampleData, arr[0]);
    }
    return sampleData;
  }
  /** A single-band template that paints the active band at the top of the page. */
  function activeBandTemplate(t) {
    var band = getActiveBand(t);
    var preview = Object.assign({}, band, {
      type: 'reportHeader',
      pageBreakBefore: false,
      pageBreakAfter: false,
      visibleWhen: undefined,
      printWhen: undefined,
    });
    return Object.assign({}, t, { bands: [preview] });
  }

  function patchBandCmd(index, patch) {
    return {
      type: 'patchBand',
      apply: function (t) {
        var bands = t.bands.slice();
        if (!bands[index]) return t;
        bands[index] = Object.assign({}, bands[index], patch);
        return Object.assign({}, t, { bands: bands });
      },
      invert: function (t) {
        var b = t.bands[index];
        if (!b) return P.NO_OP;
        var prev = {};
        Object.keys(patch).forEach(function (k) {
          prev[k] = b[k];
        });
        return patchBandCmd(index, prev);
      },
    };
  }
  function addBandCmd(band, index) {
    return {
      type: 'addBand',
      apply: function (t) {
        var bands = t.bands.slice();
        var i = index == null ? bands.length : index;
        bands.splice(i, 0, band);
        return Object.assign({}, t, { bands: bands });
      },
      invert: function () {
        return removeBandByIdCmd(band.id);
      },
    };
  }
  function removeBandByIdCmd(id) {
    return {
      type: 'removeBand',
      apply: function (t) {
        return Object.assign({}, t, {
          bands: t.bands.filter(function (b) {
            return b.id !== id;
          }),
        });
      },
      invert: function (t) {
        var i = t.bands
          .map(function (b) {
            return b.id;
          })
          .indexOf(id);
        return i === -1 ? P.NO_OP : addBandCmd(t.bands[i], i);
      },
    };
  }
  function moveBandCmd(from, to) {
    return {
      type: 'moveBand',
      apply: function (t) {
        var bands = t.bands.slice();
        var b = bands.splice(from, 1)[0];
        if (!b) return t;
        bands.splice(to, 0, b);
        return Object.assign({}, t, { bands: bands });
      },
      invert: function () {
        return moveBandCmd(to, from);
      },
    };
  }
  function setActiveBand(i) {
    activeBand = i;
    clampActiveBand(store.getState());
    selected = [];
    renderCanvas();
    renderInspector();
    renderLayers();
  }

  function renderCanvas() {
    var t = store.getState();
    clampActiveBand(t);
    var size = pageSize(t);
    pageEl.style.width = size.width * zoom + 'px';
    pageEl.style.height = size.height * zoom + 'px';
    var m = t.page.margins;
    marginsEl.style.left = m.left * zoom + 'px';
    marginsEl.style.top = m.top * zoom + 'px';
    marginsEl.style.right = m.right * zoom + 'px';
    marginsEl.style.bottom = m.bottom * zoom + 'px';

    // WYSIWYG layer: the engine's own SVG painting of just the active band,
    // isolated at the top so band-relative overlays line up (§7). The Preview
    // pane shows the full multi-band paginated document.
    try {
      var doc = P.layoutDocument(displayTemplate(activeBandTemplate(t)), {
        data: activeBandData(t),
      });
      pageSvgEl.innerHTML = doc.pages.length ? P.paintPageToSvg(doc.pages[0]) : '';
      var svgNode = pageSvgEl.querySelector('svg');
      if (svgNode) {
        svgNode.setAttribute('width', size.width * zoom);
        svgNode.setAttribute('height', size.height * zoom);
      }
    } catch (err) {
      pageSvgEl.innerHTML = '';
    }

    // interactive overlays from the source elements
    Array.prototype.slice.call(pageEl.querySelectorAll('.el')).forEach(function (n) {
      n.remove();
    });
    var band = getActiveBand(t);
    // what each element actually rendered — used to flag empty ones with a hint
    var renderedText = {};
    try {
      var laid = doc && doc.pages && doc.pages[0] ? doc.pages[0].elements : [];
      laid.forEach(function (le) {
        if (le && le.id != null)
          renderedText[le.id] = le.text != null ? le.text : le.lines ? le.lines.join('') : '';
      });
    } catch (e) {
      /* ignore */
    }
    // Append overlays in paint order (zIndex ascending, array order as the
    // tiebreak) so the visually top-most element is last in the DOM and wins
    // the click on overlapping elements — matching what the SVG shows.
    var ordered = band.elements.slice().sort(function (a, b) {
      return (a.zIndex || 1) - (b.zIndex || 1);
    });
    ordered.forEach(function (el) {
      var node = document.createElement('div');
      node.className = 'el' + (isSelected(el.id) ? ' selected' : '');
      node.dataset.id = el.id;
      node.title = faName(el.type);
      // keyboard access (design-review 1.3): Tab reaches elements, Enter/Space selects
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', faName(el.type));
      node.setAttribute('aria-pressed', isSelected(el.id) ? 'true' : 'false');
      var b = el.bounds;
      node.style.left = (m.left + b.x) * zoom + 'px';
      node.style.top = (m.top + b.y) * zoom + 'px';
      node.style.width = Math.max(4, b.width * zoom) + 'px';
      node.style.height = Math.max(4, b.height * zoom) + 'px';
      // an element that paints nothing is invisible on the canvas — give it a
      // dashed outline + a hint so it's findable and its purpose is clear
      var textual = el.type === 'staticText' || el.type === 'dataField' || el.type === 'pageField';
      if (textual) {
        var shown = renderedText[el.id];
        if (shown == null || String(shown).trim() === '') {
          var ph = document.createElement('div');
          ph.className = 'el-placeholder';
          var boundSource = el.value && el.value.source;
          ph.textContent =
            el.type === 'dataField'
              ? boundSource
                ? '⟨' + boundSource + '⟩'
                : 'فیلد داده — دوبارکلیک برای بایند'
              : 'متن خالی — دوبارکلیک';
          ph.style.direction = el.type === 'dataField' && boundSource ? 'ltr' : 'rtl';
          node.appendChild(ph);
          node.classList.add('is-empty');
        }
      }
      pageEl.appendChild(node);
      if (selected.length === 1 && isSelected(el.id)) {
        var handle = document.createElement('div');
        handle.className = 'handle';
        handle.dataset.resize = el.id;
        node.appendChild(handle);
      }
    });
    document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
    document.getElementById('canvasHint').classList.toggle('show', band.elements.length === 0);
    renderQuickbar(t, m);
  }

  /** Floating quick actions above the selection's bounding box (§8A). */
  var quickbarEl = document.getElementById('quickbar');
  quickbarEl.addEventListener('mousedown', function (e) {
    e.stopPropagation();
    e.preventDefault();
  });
  quickbarEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    var q = btn.dataset.q;
    if (q === 'dup') duplicateSelected();
    else if (q === 'front') reorderSelected(true);
    else if (q === 'back') reorderSelected(false);
    else if (q === 'del') deleteSelected();
  });
  function renderQuickbar(t, m) {
    if (!selected.length) {
      quickbarEl.classList.remove('show');
      return;
    }
    var minX = Infinity,
      minY = Infinity,
      maxX = -Infinity;
    selected.forEach(function (id) {
      var loc = P.findElement(t, id);
      if (!loc) return;
      var b = loc.element.bounds;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
    });
    if (!isFinite(minX)) {
      quickbarEl.classList.remove('show');
      return;
    }
    quickbarEl.innerHTML =
      '<button data-q="dup" title="کپی (Ctrl+D)">' +
      '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7" y="7" width="9" height="9" rx="2"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/></svg></button>' +
      '<button data-q="front" title="بیار جلو">' +
      '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 14V5m0 0L6.5 8.5M10 5l3.5 3.5"/></svg></button>' +
      '<button data-q="back" title="بفرست عقب">' +
      '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 6v9m0 0 3.5-3.5M10 15l-3.5-3.5"/></svg></button>' +
      '<span class="qsep"></span>' +
      '<button data-q="del" class="danger" title="حذف (Delete)">' +
      '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m3 0-.7 9.2A2 2 0 0 1 12.3 17H7.7a2 2 0 0 1-2-1.8L5 6"/></svg></button>';
    var midX = (m.left + (minX + maxX) / 2) * zoom;
    var topY = (m.top + minY) * zoom;
    quickbarEl.style.left = midX - quickbarEl.offsetWidth / 2 + 'px';
    quickbarEl.style.top = Math.max(4, topY - 40) + 'px';
    quickbarEl.classList.add('show');
    // re-center once real width is known
    quickbarEl.style.left = midX - quickbarEl.offsetWidth / 2 + 'px';
    upgradeTooltips(quickbarEl);
  }

  /** Layers panel: top-most first, click to select, shift-click to toggle. */
  var layersEl = document.getElementById('layers');
  function layerLabel(el) {
    if (el.type === 'staticText' && el.text) return el.text;
    if (el.value && el.value.source) return el.value.source;
    if (el.type === 'chart') return faName(el.type) + ' · ' + (el.chartKind || '');
    return faName(el.type);
  }
  function renderLayers() {
    var t = store.getState();
    var els = getActiveBand(t).elements.slice().reverse();
    if (!els.length) {
      layersEl.innerHTML =
        '<div class="layers-empty">هنوز الِمانی نداری.<br>از جعبه‌ابزار یکی بکش روی بوم.</div>';
      return;
    }
    layersEl.innerHTML = els
      .map(function (el) {
        return (
          '<div class="layer' +
          (isSelected(el.id) ? ' selected' : '') +
          '" role="button" tabindex="0" aria-pressed="' +
          (isSelected(el.id) ? 'true' : 'false') +
          '" title="کلیک: انتخاب · Shift+کلیک: افزودن به انتخاب" data-id="' +
          esc(el.id) +
          '"><span class="l-ico">' +
          typeIcon(el.type, 13) +
          '</span><span class="l-name">' +
          esc(layerLabel(el)) +
          '</span><span class="l-type">' +
          esc(el.type) +
          '</span></div>'
        );
      })
      .join('');
    upgradeTooltips(layersEl);
  }
  // shared selection used by layer rows + canvas elements (mouse and keyboard)
  function selectById(id, additive) {
    if (additive) {
      var i = selected.indexOf(id);
      if (i === -1) selected.push(id);
      else selected.splice(i, 1);
    } else {
      selected = [id];
    }
    renderCanvas();
    renderInspector();
    renderLayers();
    renderStatus(); // keep the status bar's selection info in sync
  }
  function refocusById(container, id) {
    var safe = window.CSS && CSS.escape ? CSS.escape(id) : id;
    var again = container.querySelector('[data-id="' + safe + '"]');
    if (again) again.focus();
  }
  function isActivateKey(e) {
    return e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
  }
  layersEl.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.layer') : null;
    if (!row) return;
    selectById(row.dataset.id, e.shiftKey);
  });
  layersEl.addEventListener('keydown', function (e) {
    if (!isActivateKey(e)) return;
    var row = e.target.closest ? e.target.closest('.layer') : null;
    if (!row) return;
    e.preventDefault();
    selectById(row.dataset.id, e.shiftKey);
    refocusById(layersEl, row.dataset.id); // rows are rebuilt on render — keep focus
  });
  // canvas: Enter/Space on a focused element selects it (design-review 1.3)
  pageEl.addEventListener('keydown', function (e) {
    if (!isActivateKey(e)) return;
    var node = e.target.closest ? e.target.closest('.el') : null;
    if (!node) return;
    e.preventDefault();
    selectById(node.dataset.id, e.shiftKey);
    refocusById(pageEl, node.dataset.id);
  });

  /** Status bar: page info + selection info. */
  function renderStatus() {
    var t = store.getState();
    var size = t.page.size;
    var sizeName =
      typeof size === 'string'
        ? size
        : Math.round(size.width) + '×' + Math.round(size.height) + 'pt';
    document.getElementById('pageInfo').textContent =
      sizeName + ' · ' + (t.page.orientation === 'landscape' ? 'افقی' : 'عمودی');
    var sel = document.getElementById('selInfo');
    if (!selected.length) sel.textContent = 'چیزی انتخاب نشده';
    else if (selected.length === 1) {
      var loc = P.findElement(t, selected[0]);
      sel.textContent = loc ? faName(loc.element.type) + ' انتخاب شده' : '';
    } else sel.textContent = selected.length + ' الِمان انتخاب شده';
  }

  // --- snapping ------------------------------------------------------------
  function snapEdges(t, excludeIds) {
    var xs = [];
    var ys = [];
    getActiveBand(t).elements.forEach(function (el) {
      if (excludeIds.indexOf(el.id) !== -1) return;
      xs.push(el.bounds.x, el.bounds.x + el.bounds.width);
      ys.push(el.bounds.y, el.bounds.y + el.bounds.height);
    });
    return { xs: xs, ys: ys };
  }
  function snapValue(v, edges, disabled) {
    if (disabled) return { v: v, guide: null };
    for (var i = 0; i < edges.length; i++) {
      if (Math.abs(edges[i] - v) <= SNAP_EDGE) return { v: edges[i], guide: edges[i] };
    }
    return { v: Math.round(v / GRID) * GRID, guide: null };
  }
  function showGuides(t, gx, gy) {
    var m = t.page.margins;
    if (gx !== null) {
      guideV.style.left = (m.left + gx) * zoom + 'px';
      guideV.style.display = 'block';
    } else guideV.style.display = 'none';
    if (gy !== null) {
      guideH.style.top = (m.top + gy) * zoom + 'px';
      guideH.style.display = 'block';
    } else guideH.style.display = 'none';
  }
  function hideGuides() {
    guideV.style.display = 'none';
    guideH.style.display = 'none';
  }

  // --- drag & resize -------------------------------------------------------
  var drag = null;
  pageEl.addEventListener('mousedown', function (e) {
    var resizeId = e.target.dataset && e.target.dataset.resize;
    var elNode = e.target.closest ? e.target.closest('.el') : null;
    if (resizeId) {
      var loc = P.findElement(store.getState(), resizeId);
      drag = {
        mode: 'resize',
        id: resizeId,
        sx: e.clientX,
        sy: e.clientY,
        b: Object.assign({}, loc.element.bounds),
      };
      e.preventDefault();
      return;
    }
    if (elNode) {
      var id = elNode.dataset.id;
      if (e.shiftKey) {
        // toggle in/out of the multi-selection
        var idx = selected.indexOf(id);
        if (idx === -1) selected.push(id);
        else selected.splice(idx, 1);
      } else if (!isSelected(id)) {
        selected = [id];
      }
      var starts = {};
      selected.forEach(function (sid) {
        var l = P.findElement(store.getState(), sid);
        if (l) starts[sid] = Object.assign({}, l.element.bounds);
      });
      drag = {
        mode: 'move',
        ids: selected.slice(),
        sx: e.clientX,
        sy: e.clientY,
        starts: starts,
        moved: false,
        gkey: 'drag' + ++dragSeq,
      };
      setTab('design');
      renderInspector();
      renderCanvas();
      e.preventDefault();
    } else {
      // empty page: start a marquee selection
      var rect = pageEl.getBoundingClientRect();
      drag = {
        mode: 'marquee',
        x0: (e.clientX - rect.left) / zoom,
        y0: (e.clientY - rect.top) / zoom,
        x1: (e.clientX - rect.left) / zoom,
        y1: (e.clientY - rect.top) / zoom,
      };
      selected = [];
      renderInspector();
      renderCanvas();
      e.preventDefault();
    }
  });

  var marqueeEl = document.getElementById('marquee');
  function drawMarquee(d) {
    var x = Math.min(d.x0, d.x1) * zoom;
    var y = Math.min(d.y0, d.y1) * zoom;
    marqueeEl.style.left = x + 'px';
    marqueeEl.style.top = y + 'px';
    marqueeEl.style.width = Math.abs(d.x1 - d.x0) * zoom + 'px';
    marqueeEl.style.height = Math.abs(d.y1 - d.y0) * zoom + 'px';
    marqueeEl.style.display = 'block';
  }
  function finishMarquee(d) {
    marqueeEl.style.display = 'none';
    var t = store.getState();
    var m = t.page.margins;
    var x0 = Math.min(d.x0, d.x1) - m.left;
    var y0 = Math.min(d.y0, d.y1) - m.top;
    var x1 = Math.max(d.x0, d.x1) - m.left;
    var y1 = Math.max(d.y0, d.y1) - m.top;
    if (x1 - x0 < 3 && y1 - y0 < 3) return; // treat as a plain click
    selected = getActiveBand(t)
      .elements.filter(function (el) {
        var b = el.bounds;
        return b.x < x1 && b.x + b.width > x0 && b.y < y1 && b.y + b.height > y0;
      })
      .map(function (el) {
        return el.id;
      });
    renderInspector();
    renderCanvas();
  }

  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    if (drag.mode === 'marquee') {
      var rect = pageEl.getBoundingClientRect();
      drag.x1 = (e.clientX - rect.left) / zoom;
      drag.y1 = (e.clientY - rect.top) / zoom;
      drawMarquee(drag);
      return;
    }
    var t = store.getState();
    var dx = (e.clientX - drag.sx) / zoom;
    var dy = (e.clientY - drag.sy) / zoom;
    if (drag.mode === 'resize') {
      var edges = snapEdges(t, [drag.id]);
      var rx = snapValue(drag.b.x + Math.max(8, drag.b.width + dx), edges.xs, e.altKey);
      var ry = snapValue(drag.b.y + Math.max(8, drag.b.height + dy), edges.ys, e.altKey);
      showGuides(t, rx.guide, ry.guide);
      store.dispatch(
        P.setElementBounds(
          drag.id,
          {
            x: drag.b.x,
            y: drag.b.y,
            width: Math.max(8, rx.v - drag.b.x),
            height: Math.max(8, ry.v - drag.b.y),
          },
          true,
        ),
      );
      return;
    }
    // move: snap the primary element, translate the rest by the same delta
    var primary = drag.ids[drag.ids.length - 1];
    var pb = drag.starts[primary];
    if (!pb) return;
    var edges2 = snapEdges(t, drag.ids);
    var sx = snapValue(pb.x + dx, edges2.xs, e.altKey);
    var sy = snapValue(pb.y + dy, edges2.ys, e.altKey);
    showGuides(t, sx.guide, sy.guide);
    var fx = sx.v - pb.x;
    var fy = sy.v - pb.y;
    drag.moved = true;
    // Whole selection moves as ONE coalescing step (all elements share this
    // gesture's key), so a group drag is a single undo — not one per element.
    var moves = [];
    drag.ids.forEach(function (id) {
      var b0 = drag.starts[id];
      if (!b0) return;
      moves.push(
        P.setElementBounds(id, { x: b0.x + fx, y: b0.y + fy, width: b0.width, height: b0.height }),
      );
    });
    if (moves.length) store.dispatch(P.composite(moves, drag.gkey));
  });

  window.addEventListener('mouseup', function () {
    if (drag) {
      if (drag.mode === 'marquee') finishMarquee(drag);
      drag = null;
      hideGuides();
      renderInspector();
    }
  });

  // --- inline edit (double-click) -------------------------------------------
  pageEl.addEventListener('dblclick', function (e) {
    var elNode = e.target.closest ? e.target.closest('.el') : null;
    if (!elNode) return;
    var id = elNode.dataset.id;
    var loc = P.findElement(store.getState(), id);
    if (!loc) return;
    var el = loc.element;
    var isText = el.type === 'staticText';
    var isField = el.type === 'dataField' || el.type === 'barcode' || el.type === 'qrcode';
    if (!isText && !isField) return;
    var input = document.createElement('input');
    input.className = 'inline-edit';
    input.value = isText ? el.text || '' : el.value ? el.value.source : '';
    input.style.left = elNode.style.left;
    input.style.top = elNode.style.top;
    input.style.width = Math.max(120, parseFloat(elNode.style.width)) + 'px';
    input.style.height = Math.max(22, parseFloat(elNode.style.height)) + 'px';
    input.dir = isField ? 'ltr' : store.getState().page.direction;
    pageEl.appendChild(input);
    input.focus();
    input.select();
    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      var v = input.value;
      input.remove();
      if (!save) return;
      update(id, function (n) {
        if (isText) n.text = v;
        else n.value = { source: v };
        return n;
      });
    }
    input.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') commit(true);
      else if (ev.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', function () {
      commit(true);
    });
  });

  // --- field picker (drag-to-bind) ------------------------------------------
  var fieldPickerEl = document.getElementById('fieldPicker');
  function dataPaths(obj, prefix, out) {
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      var p = prefix ? prefix + '.' + k : k;
      if (Array.isArray(v)) {
        if (v.length && typeof v[0] === 'object' && v[0] !== null) {
          Object.keys(v[0]).forEach(function (f) {
            out.push(p + '[0].' + f);
          });
        }
        out.push('len(' + p + ')');
      } else if (v && typeof v === 'object') {
        dataPaths(v, p, out);
      } else {
        out.push(p);
      }
    });
    return out;
  }
  function renderFieldPicker() {
    var paths = dataPaths(sampleData, '', []);
    fieldPickerEl.innerHTML = paths
      .map(function (p) {
        return (
          '<span class="fp-item" draggable="true" title="بکش و روی بوم رها کن — یا روی یک الِمان تا بایندش شود" data-path="' +
          esc(p) +
          '">' +
          esc(p) +
          '</span>'
        );
      })
      .join('');
    upgradeTooltips(fieldPickerEl);
    fieldPickerEl.querySelectorAll('.fp-item').forEach(function (chip) {
      chip.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', chip.dataset.path);
        ev.dataTransfer.effectAllowed = 'copy';
      });
    });
  }
  pageEl.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.querySelectorAll('.tool[data-add]').forEach(function (toolBtn) {
    toolBtn.addEventListener('dragstart', function (ev) {
      ev.dataTransfer.setData('text/plain', '__add__:' + toolBtn.dataset.add);
      ev.dataTransfer.effectAllowed = 'copy';
    });
  });

  pageEl.addEventListener('drop', function (e) {
    e.preventDefault();
    var path = e.dataTransfer.getData('text/plain');
    if (!path) return;
    if (path.indexOf('__add__:') === 0) {
      // dropped a toolbox tool: create that element at the drop point
      var addType = path.slice(8);
      var rect0 = pageEl.getBoundingClientRect();
      var t0 = store.getState();
      var m0 = t0.page.margins;
      var id0 = 'el-' + uid++;
      var make = DEFAULTS[addType] || DEFAULTS.staticText;
      var el0 = make({ id: id0, bounds: { x: 40, y: 80, width: 200, height: 24 }, zIndex: 1 });
      el0.bounds = Object.assign({}, el0.bounds, {
        x: Math.max(0, Math.round((e.clientX - rect0.left) / zoom - m0.left)),
        y: Math.max(0, Math.round((e.clientY - rect0.top) / zoom - m0.top)),
      });
      selected = [id0];
      setTab('design');
      dispatchAddElement(el0);
      return;
    }
    var target = e.target.closest ? e.target.closest('.el') : null;
    if (target) {
      // drop on an element: rebind it (fields/barcode/qr get their value)
      var loc = P.findElement(store.getState(), target.dataset.id);
      if (loc && ('value' in loc.element || loc.element.type === 'dataField')) {
        update(target.dataset.id, function (n) {
          n.value = { source: path };
          return n;
        });
        return;
      }
    }
    // drop on empty canvas: create a bound dataField at the drop point
    var rect = pageEl.getBoundingClientRect();
    var t = store.getState();
    var m = t.page.margins;
    var x = Math.round((e.clientX - rect.left) / zoom - m.left);
    var y = Math.round((e.clientY - rect.top) / zoom - m.top);
    var id = 'el-' + uid++;
    selected = [id];
    store.dispatch(
      P.addElement(getActiveBand(t).id, {
        id: id,
        type: 'dataField',
        bounds: { x: Math.max(0, x), y: Math.max(0, y), width: 180, height: 18 },
        zIndex: 1,
        value: { source: path },
        typography: { fontFamily: 'Vazirmatn', fontSize: 12 },
      }),
    );
  });

  // --- zoom ----------------------------------------------------------------
  function setZoom(z) {
    zoom = Math.min(2, Math.max(0.4, z));
    renderCanvas();
  }
  document.getElementById('zoomIn').addEventListener('click', function () {
    setZoom(zoom + 0.1);
  });
  document.getElementById('zoomOut').addEventListener('click', function () {
    setZoom(zoom - 0.1);
  });
  document.getElementById('zoomReset').addEventListener('click', function () {
    setZoom(1);
  });
  document.getElementById('zoomFit').addEventListener('click', function () {
    var wrap = document.querySelector('.canvas-wrap');
    var size = pageSize(store.getState());
    setZoom(Math.min((wrap.clientWidth - 90) / size.width, (wrap.clientHeight - 90) / size.height));
  });
  document.querySelector('.canvas-wrap').addEventListener(
    'wheel',
    function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
    },
    { passive: false },
  );

  // --- inspector -----------------------------------------------------------
  var inspectorEl = document.getElementById('inspector');
  function field(label, inputHtml) {
    return '<div class="row"><label>' + label + '</label>' + inputHtml + '</div>';
  }

  // The band strip + active-band settings live at the top of the inspector.
  function bandBarHtml(t) {
    var chips = t.bands
      .map(function (band, i) {
        return (
          '<button class="band-chip' +
          (i === activeBand ? ' active' : '') +
          '" data-band="' +
          i +
          '" title="ویرایش این باند">' +
          esc(bandTypeName(band.type)) +
          '<small>' +
          band.elements.length +
          '</small></button>'
        );
      })
      .join('');
    return (
      '<div class="sec"><div class="sec-title">باندها <small class="hint">· بخش‌های گزارش</small></div>' +
      '<div class="band-bar">' +
      chips +
      '<button class="band-add" data-band-add title="افزودن باند ردیف داده">+</button>' +
      '</div></div>'
    );
  }
  function bandSettingsHtml(t) {
    var band = getActiveBand(t);
    var i = activeBand;
    var h = band.height && band.height.mode === 'fixed' ? band.height.value : '';
    var typeOpts = BAND_TYPES.map(function (bt) {
      return (
        '<option value="' +
        bt.type +
        '"' +
        (bt.type === band.type ? ' selected' : '') +
        '>' +
        bt.name +
        '</option>'
      );
    }).join('');
    var s =
      '<div class="sec head"><span class="el-ico">▤</span><div><b>' +
      esc(bandTypeName(band.type)) +
      '</b><small>باند · ' +
      band.elements.length +
      ' الِمان</small></div></div>';
    s += '<div class="sec"><div class="sec-title">تنظیمات باند</div>';
    s += field('نوع', '<select data-band-type>' + typeOpts + '</select>');
    s += field(
      'ارتفاع',
      '<input type="number" min="8" data-band-height title="ارتفاع باند (pt)" value="' +
        (h === '' ? '' : Math.round(h)) +
        '">',
    );
    if (isRowBand(band)) {
      s += field(
        'دیتاست ردیف',
        '<input dir="ltr" data-band-dataset title="نام آرایهٔ داده که این باند به‌ازای هر عضو آن تکرار می‌شود" value="' +
          esc(band.dataset || '') +
          '">',
      );
    }
    if (band.type === 'pageHeader' || band.type === 'pageFooter') {
      var master = band.master || 'all';
      var mOpts = [
        ['all', 'همهٔ صفحات'],
        ['first', 'فقط صفحهٔ اول'],
        ['odd', 'صفحات فرد'],
        ['even', 'صفحات زوج'],
      ]
        .map(function (o) {
          return (
            '<option value="' +
            o[0] +
            '"' +
            (o[0] === master ? ' selected' : '') +
            '>' +
            o[1] +
            '</option>'
          );
        })
        .join('');
      s += field(
        'تکرار روی',
        '<select title="این سرصفحه/پاصفحه روی کدام صفحات نمایش داده شود" data-band-master>' +
          mOpts +
          '</select>',
      );
    }
    s +=
      '<div class="btnrow">' +
      '<button data-band-up title="جابه‌جایی به بالا"' +
      (i === 0 ? ' disabled' : '') +
      '>↑ بالا</button>' +
      '<button data-band-down title="جابه‌جایی به پایین"' +
      (i === t.bands.length - 1 ? ' disabled' : '') +
      '>↓ پایین</button>' +
      '<button data-band-del title="حذف این باند"' +
      (t.bands.length <= 1 ? ' disabled' : '') +
      '>حذف باند</button>' +
      '</div></div>';
    s +=
      '<p class="empty"><span class="glyph">⬚</span>الِمانی انتخاب نشده<br>' +
      'از جعبه‌ابزار روی این باند بکش، یا روی بوم کلیک کن.</p>';
    return s;
  }
  function addBand() {
    var id = 'band-' + uid++;
    var ds = detectDataset();
    var newBand = {
      id: id,
      type: 'detail',
      height: { mode: 'fixed', value: 60 },
      dataset: ds.name,
      elements: [],
    };
    var idx = store.getState().bands.length;
    store.dispatch(P.composite([ensureDatasetCmd(ds.name), addBandCmd(newBand, idx)]));
    setActiveBand(idx);
  }
  function wireBandBar() {
    inspectorEl.querySelectorAll('[data-band]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        setActiveBand(Number(chip.dataset.band));
      });
    });
    var addBtn = inspectorEl.querySelector('[data-band-add]');
    if (addBtn) addBtn.addEventListener('click', addBand);
  }
  function wireBandSettings() {
    var i = activeBand;
    var typeSel = inspectorEl.querySelector('[data-band-type]');
    if (typeSel)
      typeSel.addEventListener('change', function () {
        var patch = { type: typeSel.value };
        if (typeSel.value === 'detail' && !getActiveBand(store.getState()).dataset) {
          var ds = detectDataset();
          patch.dataset = ds.name;
          store.dispatch(P.composite([ensureDatasetCmd(ds.name), patchBandCmd(i, patch)]));
        } else {
          store.dispatch(patchBandCmd(i, patch));
        }
        renderCanvas();
        renderInspector();
      });
    var hInp = inspectorEl.querySelector('[data-band-height]');
    if (hInp)
      hInp.addEventListener('change', function () {
        store.dispatch(
          patchBandCmd(i, { height: { mode: 'fixed', value: Number(hInp.value) || 8 } }),
        );
      });
    var masterSel = inspectorEl.querySelector('[data-band-master]');
    if (masterSel)
      masterSel.addEventListener('change', function () {
        store.dispatch(patchBandCmd(i, { master: masterSel.value }));
      });
    var dsInp = inspectorEl.querySelector('[data-band-dataset]');
    if (dsInp)
      dsInp.addEventListener('change', function () {
        var v = dsInp.value.trim();
        store.dispatch(P.composite([ensureDatasetCmd(v), patchBandCmd(i, { dataset: v })]));
        renderCanvas();
        renderInspector();
      });
    var up = inspectorEl.querySelector('[data-band-up]');
    if (up)
      up.addEventListener('click', function () {
        if (i <= 0) return;
        store.dispatch(moveBandCmd(i, i - 1));
        setActiveBand(i - 1);
      });
    var down = inspectorEl.querySelector('[data-band-down]');
    if (down)
      down.addEventListener('click', function () {
        if (i >= store.getState().bands.length - 1) return;
        store.dispatch(moveBandCmd(i, i + 1));
        setActiveBand(i + 1);
      });
    var del = inspectorEl.querySelector('[data-band-del]');
    if (del)
      del.addEventListener('click', function () {
        var st = store.getState();
        if (st.bands.length <= 1) return;
        store.dispatch(removeBandByIdCmd(getActiveBand(st).id));
        setActiveBand(Math.min(i, store.getState().bands.length - 1));
      });
  }

  function renderInspector() {
    var t = store.getState();
    clampActiveBand(t);
    var id = lastSelected();
    var loc = id ? P.findElement(t, id) : null;
    if (!loc) {
      inspectorEl.innerHTML = bandBarHtml(t) + bandSettingsHtml(t);
      wireBandBar();
      wireBandSettings();
      upgradeTooltips(inspectorEl);
      return;
    }
    var el = loc.element,
      b = el.bounds,
      ty = el.typography || {};
    var multi = selected.length > 1 ? ' · ' + selected.length + ' الِمان انتخاب شده' : '';

    var displayName =
      el.type === 'container' && labeledValue(el) ? 'فیلد برچسب‌دار' : faName(el.type);
    var html =
      bandBarHtml(t) +
      '<div class="sec head"><span class="el-ico">' +
      typeIcon(el.type, 18) +
      '</span><div><b>' +
      displayName +
      '</b><small>' +
      el.type +
      multi +
      '</small></div></div>';

    // --- placement ----------------------------------------------------------
    html += '<div class="sec"><div class="sec-title">قرارگیری و اندازه</div>';
    html +=
      '<div class="grid2">' +
      numField('x', b.x) +
      numField('y', b.y) +
      numField('w', b.width) +
      numField('h', b.height) +
      '</div>';
    html += field(
      'چرخش',
      '<input type="number" title="چرخش الِمان به درجه — مثبت = ساعتگرد" data-prop="rotation" value="' +
        (el.rotation || 0) +
        '" step="15">',
    );
    html +=
      '<div class="btnrow">' +
      '<button data-z="front" title="نمایش روی الِمان‌های دیگر">⬆ بیار جلو</button>' +
      '<button data-z="back" title="نمایش زیر الِمان‌های دیگر">⬇ بفرست عقب</button>' +
      '</div>';
    html += '</div>';

    // --- alignment (multi) ----------------------------------------------------
    if (selected.length > 1) {
      html += '<div class="sec"><div class="sec-title">هم‌ترازی انتخاب</div>';
      html +=
        '<div class="btnrow">' +
        '<button data-align="left" title="چپ">⇤</button>' +
        '<button data-align="centerH" title="وسط افقی">↔</button>' +
        '<button data-align="right" title="راست">⇥</button>' +
        '<button data-align="top" title="بالا">⤒</button>' +
        '<button data-align="middle" title="وسط عمودی">↕</button>' +
        '<button data-align="bottom" title="پایین">⤓</button>' +
        '</div>';
      if (selected.length > 2) {
        html +=
          '<div class="btnrow">' +
          '<button data-dist="h">توزیع افقی</button>' +
          '<button data-dist="v">توزیع عمودی</button>' +
          '</div>';
      }
      html += '</div>';
    }

    // --- content ---------------------------------------------------------------
    var content = '';
    if (el.type === 'staticText')
      content += field('متن', '<input data-prop="text" value="' + esc(el.text || '') + '">');
    if (el.type === 'dataField' || el.type === 'barcode' || el.type === 'qrcode')
      content += field(
        el.type === 'dataField' ? 'بایند' : 'مقدار',
        '<input dir="ltr" title="عبارت داده — مثل customer.name یا qty * price" data-prop="source" value="' +
          esc(el.value ? el.value.source : '') +
          '">',
      );
    if (el.type === 'dataField') {
      var fmtVal = '';
      if (el.format) {
        if (el.format.kind === 'money')
          fmtVal = el.format.options && el.format.options.unit === 'toman' ? 'toman' : 'rial';
        else fmtVal = el.format.kind;
      }
      content += field(
        'قالب نمایش',
        '<select title="نحوهٔ نمایش مقدار: خام، عددی سه‌رقم جداکن، پول، درصد یا تاریخ" data-prop="fmt">' +
          '<option value=""' +
          (fmtVal === '' ? ' selected' : '') +
          '>خام (بدون قالب)</option>' +
          '<option value="number"' +
          (fmtVal === 'number' ? ' selected' : '') +
          '>عدد (۱٬۲۳۴)</option>' +
          '<option value="rial"' +
          (fmtVal === 'rial' ? ' selected' : '') +
          '>پول — ریال</option>' +
          '<option value="toman"' +
          (fmtVal === 'toman' ? ' selected' : '') +
          '>پول — تومان</option>' +
          '<option value="percent"' +
          (fmtVal === 'percent' ? ' selected' : '') +
          '>درصد</option>' +
          '<option value="date"' +
          (fmtVal === 'date' ? ' selected' : '') +
          '>تاریخ</option>' +
          '</select>',
      );
    }
    if (el.type === 'barcode')
      content += field(
        'نوع بارکد',
        '<select data-prop="symbology">' +
          opts(['code128', 'code39', 'ean13'], el.symbology) +
          '</select>',
      );
    if (el.type === 'pageField') {
      var pfOpts =
        '<option value="page"' +
        (el.field === 'page' ? ' selected' : '') +
        '>شماره صفحه</option>' +
        '<option value="pageCount"' +
        (el.field === 'pageCount' ? ' selected' : '') +
        '>تعداد کل صفحات</option>' +
        '<option value="currentDate"' +
        (el.field === 'currentDate' ? ' selected' : '') +
        '>تاریخ امروز</option>';
      content += field(
        'مقدار',
        '<select title="این فیلد در سرصفحه و پاصفحه مقدار می‌گیرد" data-prop="pffield">' +
          pfOpts +
          '</select>',
      );
      content +=
        '<p class="tinyhint">فقط داخل «سرصفحه» و «پاصفحه» عدد می‌گیرد. برای «۱ از ۳» یک ' +
        '«شماره صفحه» و کنارش یک «تعداد کل صفحات» بگذار و بینشان یک متنِ «از».</p>';
    }
    if (el.type === 'image') {
      content += field(
        'آدرس',
        '<input dir="ltr" data-prop="imgsource" value="' +
          esc(el.source ? el.source.source : '') +
          '">',
      );
      content += field(
        'برازش',
        '<select data-prop="fit">' +
          opts(['contain', 'cover', 'fill', 'none'], el.fit || 'contain') +
          '</select>',
      );
    }
    if (el.type === 'chart') {
      content += field(
        'نوع چارت',
        '<select data-prop="chartKind">' +
          opts(['column', 'bar', 'line', 'stackedColumn', 'area', 'pie', 'donut'], el.chartKind) +
          '</select>',
      );
      content += field(
        'دیتاست',
        '<input dir="ltr" data-prop="dataset" value="' + esc(el.dataset || '') + '">',
      );
      content += field(
        'دسته‌ها',
        '<input dir="ltr" data-prop="categories" value="' +
          esc(el.categories ? el.categories.source : '') +
          '">',
      );
      content += field(
        'مقادیر',
        '<input dir="ltr" data-prop="values" value="' +
          esc(el.series && el.series[0] ? el.series[0].values.source : '') +
          '">',
      );
    }
    if (el.type === 'table') {
      content += field(
        'دیتاست',
        '<input dir="ltr" title="نام آرایهٔ داده که هر ردیف جدول از یک عضو آن ساخته می‌شود — مثل items" data-prop="tbldataset" value="' +
          esc(el.dataset || '') +
          '">',
      );
      var cols = el.columns || [];
      var colsHtml = '<div class="col-block"><label>ستون‌ها</label><div class="cols-editor">';
      cols.forEach(function (c, i) {
        var head = c.header && c.header.text != null ? c.header.text : '';
        var src = c.detail && c.detail.content ? c.detail.content.source : '';
        var w = c.width && c.width.value != null ? c.width.value : '';
        colsHtml +=
          '<div class="col-row">' +
          '<input class="col-h" data-colhead="' +
          i +
          '" title="عنوان ستون" placeholder="عنوان" value="' +
          esc(head) +
          '">' +
          '<input class="col-s" dir="ltr" data-colsrc="' +
          i +
          '" title="منبع دادهٔ سلول — مثل name یا qty * price" placeholder="منبع" value="' +
          esc(src) +
          '">' +
          '<input class="col-w" type="number" min="1" data-colw="' +
          i +
          '" title="عرض بر حسب درصد" value="' +
          (w === '' ? '' : Math.round(w)) +
          '">' +
          '<button class="col-del" data-coldel="' +
          i +
          '" title="حذف ستون">✕</button>' +
          '</div>';
      });
      colsHtml +=
        '<button class="col-add" data-coladd title="افزودن ستون تازه">+ ستون</button></div></div>';
      content += colsHtml;
      content += field(
        'تکرار سرستون',
        '<input type="checkbox" title="سرستون‌ها بالای هر صفحه تکرار شوند" data-prop="repeathdr"' +
          (el.repeatHeader ? ' checked' : '') +
          '>',
      );
      content += field(
        'راه‌راه ردیف‌ها',
        '<input type="checkbox" title="ردیف‌های یک‌درمیان پس‌زمینهٔ روشن بگیرند" data-prop="stripe"' +
          (el.rowStripeStyleId ? ' checked' : '') +
          '>',
      );
    }
    if (el.type === 'container') {
      var lblCh = labeledLabel(el);
      var valCh = labeledValue(el);
      if (lblCh)
        content += field(
          'برچسب',
          '<input data-prop="lbltext" value="' + esc(lblCh.text || '') + '">',
        );
      if (valCh)
        content += field(
          'مقدار',
          '<input dir="ltr" title="عبارت داده — مثل company.name" data-prop="lblvalue" value="' +
            esc(valCh.value ? valCh.value.source : '') +
            '">',
        );
    }
    if (content) {
      html += '<div class="sec"><div class="sec-title">محتوا</div>' + content + '</div>';
    }

    // --- appearance ---------------------------------------------------------
    var looks = '';
    if (el.type === 'container') {
      looks += field(
        'رنگ پُری',
        '<input type="color" data-prop="cfill" value="' +
          (el.box && el.box.fill ? rgbToHex(el.box.fill.color) : '#f8fafc') +
          '">',
      );
      looks += field(
        'رنگ کادر',
        '<input type="color" data-prop="cborder" value="' +
          (el.box && el.box.border && el.box.border.all
            ? rgbToHex(el.box.border.all.color)
            : '#cbd5e1') +
          '">',
      );
    }
    if (el.type === 'line') {
      looks += field(
        'رنگ خط',
        '<input type="color" data-prop="stroke" value="' +
          rgbToHex(el.stroke ? el.stroke.color : rgb(51, 65, 85)) +
          '">',
      );
    }
    if (el.type === 'rectangle' || el.type === 'ellipse') {
      var fill = el.box && el.box.fill ? rgbToHex(el.box.fill.color) : '#f1f5f9';
      looks += field('رنگ پُری', '<input type="color" data-prop="fill" value="' + fill + '">');
    }
    if (
      el.type === 'staticText' ||
      el.type === 'dataField' ||
      el.type === 'richText' ||
      el.type === 'pageField'
    ) {
      looks += field(
        'اندازه',
        '<input type="number" data-prop="fontSize" value="' + (ty.fontSize || 12) + '">',
      );
      looks += field(
        'رنگ',
        '<input type="color" data-prop="color" value="' +
          rgbToHex(ty.color || rgb(15, 23, 42)) +
          '">',
      );
      looks += field(
        'ضخیم',
        '<input type="checkbox" data-prop="bold"' +
          (ty.fontWeight === 'bold' ? ' checked' : '') +
          '>',
      );
      looks += field(
        'چینش',
        '<select data-prop="align">' +
          opts(['start', 'center', 'end'], ty.align || 'start') +
          '</select>',
      );
    }
    if (looks) {
      var looksTitle =
        selected.length > 1
          ? 'ظاهر <small class="hint">· روی هر ' + selected.length + ' الِمان</small>'
          : 'ظاهر';
      html += '<div class="sec"><div class="sec-title">' + looksTitle + '</div>' + looks + '</div>';
    }

    // conditions (ROADMAP ۲.۳): engine-side visibleWhen + one style rule
    var cond0 = (el.conditionalStyles || [])[0];
    html +=
      '<div class="sec"><div class="sec-title">شرط‌ها</div>' +
      field(
        'نمایش اگر',
        '<input dir="ltr" title="عبارت شرطی — خالی یعنی همیشه نمایش. مثل total > 0" data-prop="viswhen" value="' +
          esc(el.visibleWhen ? el.visibleWhen.source : '') +
          '">',
      ) +
      field(
        'استایل اگر',
        '<input dir="ltr" title="اگر این شرط برقرار شود، رنگ زیر اعمال می‌شود. مثل amount < 0" data-prop="condwhen" value="' +
          esc(cond0 && cond0.when ? cond0.when.source : '') +
          '">',
      ) +
      field(
        'رنگ شرطی',
        '<input type="color" title="رنگ متن وقتی شرط بالا برقرار است" data-prop="condcolor" value="' +
          rgbToHex(
            cond0 && cond0.typography && cond0.typography.color
              ? cond0.typography.color
              : rgb(214, 69, 69),
          ) +
          '">',
      ) +
      '</div>';

    html +=
      '<div class="sec"><div class="btnrow">' +
      '<button id="dupEl" title="یک کپی با فاصلهٔ کم می‌سازد">کپی (Ctrl+D)</button>' +
      '<button id="deleteEl" title="حذف الِمان(های) انتخاب‌شده">حذف</button>' +
      '</div></div>';
    inspectorEl.innerHTML = html;
    wireInspector(el);
    wireBandBar();
    upgradeTooltips(inspectorEl);
  }
  var BOUND_TIPS = {
    x: 'فاصلهٔ افقی از لبهٔ ناحیهٔ محتوا (pt)',
    y: 'فاصلهٔ عمودی از بالای ناحیهٔ محتوا (pt)',
    w: 'پهنای الِمان (pt)',
    h: 'بلندی الِمان (pt)',
  };
  function numField(k, v) {
    return (
      '<div class="row"><label>' +
      k +
      '</label><input type="number" title="' +
      (BOUND_TIPS[k] || '') +
      '" data-bound="' +
      k +
      '" value="' +
      Math.round(v) +
      '"></div>'
    );
  }
  function opts(list, sel) {
    return list
      .map(function (o) {
        return '<option' + (o === sel ? ' selected' : '') + '>' + o + '</option>';
      })
      .join('');
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function wireInspector(el) {
    var id = el.id;
    inspectorEl.querySelectorAll('[data-bound]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.dataset.bound,
          v = Number(inp.value);
        update(id, function (e) {
          var nb = Object.assign({}, e.bounds);
          nb[k === 'w' ? 'width' : k === 'h' ? 'height' : k] = v;
          e.bounds = nb;
          return e;
        });
      });
    });
    bindProp('text', function (e, v) {
      e.text = v;
    });
    bindProp('source', function (e, v) {
      e.value = { source: v };
    });
    bindProp(
      'viswhen',
      function (e, v) {
        if (v.trim()) e.visibleWhen = { source: v.trim() };
        else delete e.visibleWhen;
      },
      true,
    );
    bindProp(
      'condwhen',
      function (e, v) {
        var prev = (e.conditionalStyles || [])[0];
        if (v.trim()) {
          e.conditionalStyles = [
            {
              when: { source: v.trim() },
              typography: prev && prev.typography ? prev.typography : { color: rgb(214, 69, 69) },
            },
          ];
        } else {
          delete e.conditionalStyles;
        }
      },
      true,
    );
    bindProp(
      'condcolor',
      function (e, v) {
        var prev = (e.conditionalStyles || [])[0];
        if (!prev) return; // color only applies once a condition exists
        e.conditionalStyles = [
          {
            when: prev.when,
            typography: Object.assign({}, prev.typography, { color: hexToRgb(v) }),
          },
        ];
      },
      true,
    );
    bindProp(
      'fmt',
      function (e, v) {
        if (v === '') delete e.format;
        else if (v === 'rial') e.format = { kind: 'money' };
        else if (v === 'toman') e.format = { kind: 'money', options: { unit: 'toman' } };
        else e.format = { kind: v };
      },
      true,
    );
    bindProp('imgsource', function (e, v) {
      e.source = { source: v };
    });
    bindProp('fit', function (e, v) {
      e.fit = v;
    });
    bindProp('symbology', function (e, v) {
      e.symbology = v;
    });
    bindProp('pffield', function (e, v) {
      e.field = v;
    });
    bindProp('chartKind', function (e, v) {
      e.chartKind = v;
    });
    bindProp('dataset', function (e, v) {
      e.dataset = v;
    });
    bindProp('categories', function (e, v) {
      e.categories = { source: v };
    });
    bindProp('values', function (e, v) {
      var s = (e.series && e.series[0]) || { name: '' };
      e.series = [Object.assign({}, s, { values: { source: v } })];
    });
    // --- table: dataset, per-column header/source/width, add/remove -----------
    var tblDs = inspectorEl.querySelector('[data-prop="tbldataset"]');
    if (tblDs)
      tblDs.addEventListener('change', function () {
        var v = tblDs.value.trim();
        // point the table at a (declared) dataset in one undo step
        store.dispatch(
          P.composite([
            ensureDatasetCmd(v),
            updateCmd(id, function (e) {
              e.dataset = v;
              return e;
            }),
          ]),
        );
      });
    function editCol(i, fn) {
      update(id, function (e) {
        var cols = (e.columns || []).slice();
        if (!cols[i]) return e;
        cols[i] = fn(Object.assign({}, cols[i]));
        e.columns = cols;
        return e;
      });
    }
    inspectorEl.querySelectorAll('[data-colhead]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        editCol(Number(inp.dataset.colhead), function (c) {
          c.header = Object.assign({}, c.header, {
            text: inp.value,
            styleId: (c.header && c.header.styleId) || 'tblHead',
          });
          return c;
        });
      });
    });
    inspectorEl.querySelectorAll('[data-colsrc]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        editCol(Number(inp.dataset.colsrc), function (c) {
          c.detail = Object.assign({}, c.detail, {
            content: { source: inp.value },
            styleId: (c.detail && c.detail.styleId) || 'tblCell',
          });
          return c;
        });
      });
    });
    inspectorEl.querySelectorAll('[data-colw]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        editCol(Number(inp.dataset.colw), function (c) {
          c.width = { kind: 'percent', value: Number(inp.value) || 1 };
          return c;
        });
      });
    });
    var colAdd = inspectorEl.querySelector('[data-coladd]');
    if (colAdd)
      colAdd.addEventListener('click', function () {
        update(id, function (e) {
          var cols = (e.columns || []).slice();
          cols.push({
            id: 'col-' + uid++,
            width: { kind: 'percent', value: 20 },
            header: { text: 'ستون', styleId: 'tblHead' },
            detail: { content: { source: '' }, styleId: 'tblCell' },
          });
          e.columns = cols;
          return e;
        });
      });
    inspectorEl.querySelectorAll('[data-coldel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = Number(btn.dataset.coldel);
        update(id, function (e) {
          var cols = (e.columns || []).slice();
          cols.splice(i, 1);
          e.columns = cols;
          return e;
        });
      });
    });
    var repHdr = inspectorEl.querySelector('[data-prop="repeathdr"]');
    if (repHdr)
      repHdr.addEventListener('change', function () {
        update(id, function (e) {
          e.repeatHeader = repHdr.checked;
          return e;
        });
      });
    var stripe = inspectorEl.querySelector('[data-prop="stripe"]');
    if (stripe)
      stripe.addEventListener('change', function () {
        update(id, function (e) {
          if (stripe.checked) e.rowStripeStyleId = 'tblCell';
          else delete e.rowStripeStyleId;
          return e;
        });
      });
    bindProp('rotation', function (e, v) {
      e.rotation = Number(v) || 0;
    });
    bindProp(
      'fontSize',
      function (e, v) {
        e.typography = Object.assign({}, e.typography, { fontSize: Number(v) });
      },
      true,
    );
    bindProp(
      'color',
      function (e, v) {
        e.typography = Object.assign({}, e.typography, { color: hexToRgb(v) });
      },
      true,
    );
    bindProp(
      'align',
      function (e, v) {
        e.typography = Object.assign({}, e.typography, { align: v });
      },
      true,
    );
    bindProp(
      'fill',
      function (e, v) {
        e.box = Object.assign({}, e.box, { fill: { color: hexToRgb(v) } });
      },
      true,
    );
    bindProp(
      'stroke',
      function (e, v) {
        e.stroke = Object.assign({ width: 1.5 }, e.stroke, { color: hexToRgb(v) });
      },
      true,
    );
    // labeled field (container): edit its caption + bound value + box colours
    bindProp('lbltext', function (e, v) {
      var ch = (e.children || []).slice();
      for (var i = 0; i < ch.length; i++)
        if (ch[i].type === 'staticText') {
          ch[i] = Object.assign({}, ch[i], { text: v });
          break;
        }
      e.children = ch;
    });
    bindProp('lblvalue', function (e, v) {
      var ch = (e.children || []).slice();
      for (var i = 0; i < ch.length; i++)
        if (ch[i].type === 'dataField') {
          ch[i] = Object.assign({}, ch[i], { value: { source: v } });
          break;
        }
      e.children = ch;
    });
    bindProp('cfill', function (e, v) {
      e.box = Object.assign({}, e.box, { fill: { color: hexToRgb(v) } });
    });
    bindProp('cborder', function (e, v) {
      var prev = (e.box && e.box.border && e.box.border.all) || { width: 1 };
      e.box = Object.assign({}, e.box, {
        border: { all: Object.assign({}, prev, { color: hexToRgb(v) }) },
      });
    });
    var boldInp = inspectorEl.querySelector('[data-prop="bold"]');
    if (boldInp)
      boldInp.addEventListener('change', function () {
        // bold fans out to the whole selection like the other appearance controls
        updateSelected(function (e) {
          e.typography = Object.assign({}, e.typography, {
            fontWeight: boldInp.checked ? 'bold' : 'normal',
          });
          return e;
        });
      });
    inspectorEl.querySelectorAll('[data-align]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        alignSelected(btn.dataset.align);
      });
    });
    inspectorEl.querySelectorAll('[data-dist]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        distributeSelected(btn.dataset.dist);
      });
    });
    inspectorEl.querySelectorAll('[data-z]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        reorderSelected(btn.dataset.z === 'front');
      });
    });
    var dup = document.getElementById('dupEl');
    if (dup) dup.addEventListener('click', duplicateSelected);
    var del = document.getElementById('deleteEl');
    if (del) del.addEventListener('click', deleteSelected);
    function bindProp(prop, mut, bulk) {
      var inp = inspectorEl.querySelector('[data-prop="' + prop + '"]');
      if (!inp || prop === 'bold') return;
      inp.addEventListener('change', function () {
        var apply = function (e) {
          mut(e, inp.value);
          return e;
        };
        // appearance/format/conditions fan out to the whole selection; content
        // identity (text, bindings, columns…) stays on the primary element.
        if (bulk) updateSelected(apply);
        else update(id, apply);
      });
    }
  }

  // --- live preview --------------------------------------------------------
  var previewEl = document.getElementById('preview');
  var diagEl = document.getElementById('diag');
  var previewTimer = null;
  function renderPreview() {
    if (!previewEl.classList.contains('show')) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      try {
        var res = P.renderToSvg(store.getState(), { data: sampleData });
        previewEl.innerHTML = res.pages
          .map(function (svg) {
            return '<div class="page-svg">' + svg + '</div>';
          })
          .join('');
      } catch (err) {
        previewEl.innerHTML = '<p class="diag">' + esc(err.message) + '</p>';
      }
    }, 120);
  }

  // --- top bar actions -----------------------------------------------------
  document.querySelectorAll('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      addElement(btn.dataset.add);
    });
  });
  document.getElementById('undo').addEventListener('click', function () {
    store.undo();
  });
  document.getElementById('redo').addEventListener('click', function () {
    store.redo();
  });
  document.getElementById('togglePreview').addEventListener('click', function () {
    previewEl.classList.toggle('show');
    renderPreview();
  });
  document.getElementById('pageDir').addEventListener('change', function (e) {
    store.dispatch(P.patchPageSetup({ direction: e.target.value }));
  });
  document.getElementById('pageSize').addEventListener('change', function (e) {
    if (e.target.value === '__custom__') {
      // seed the custom inputs with the current resolved dimensions so the
      // page does not jump; edits below dispatch the real size.
      var cur = pageSize(store.getState());
      store.dispatch(
        P.patchPageSetup({
          size: { width: Math.round(cur.width), height: Math.round(cur.height) },
        }),
      );
    } else {
      store.dispatch(P.patchPageSetup({ size: e.target.value }));
    }
  });
  function dispatchCustomSize() {
    var w = Math.max(40, Number(document.getElementById('pageW').value) || 0);
    var hgt = Math.max(40, Number(document.getElementById('pageH').value) || 0);
    store.dispatch(P.patchPageSetup({ size: { width: w, height: hgt } }));
  }
  document.getElementById('pageW').addEventListener('change', dispatchCustomSize);
  document.getElementById('pageH').addEventListener('change', dispatchCustomSize);
  document.getElementById('pageOrient').addEventListener('change', function (e) {
    store.dispatch(P.patchPageSetup({ orientation: e.target.value }));
  });
  document.getElementById('exportJson').addEventListener('click', function () {
    download(
      P.serializeTemplate(store.getState(), { indent: 2 }),
      'template.json',
      'application/json',
    );
  });
  document.getElementById('importJson').addEventListener('click', function () {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var res = P.importTemplate(String(reader.result));
      if (!res.success) {
        var detail = res.issues
          .map(function (i) {
            return i.path + ': ' + i.message;
          })
          .join('\n');
        diagEl.textContent = 'JSON نامعتبر:\n' + detail;
        // surface it wherever the user is — not just on the hidden data tab
        toast('واردکردن ناموفق — JSON نامعتبر:\n' + detail.split('\n')[0], true);
        return;
      }
      loadTemplate(res.value);
    };
    reader.readAsText(file);
  });
  document.getElementById('downloadPdf').addEventListener('click', async function () {
    try {
      var fonts = window.VAZIRMATN_BASE64
        ? [{ family: 'Vazirmatn', bytes: base64ToBytes(window.VAZIRMATN_BASE64) }]
        : [];
      var res = await P.renderToPdf(
        store.getState(),
        { data: sampleData, now: Date.now() },
        { pdf: { fonts: fonts } },
      );
      var blob = new Blob([res.bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'document.pdf';
      a.click();
      URL.revokeObjectURL(url);
      diagEl.textContent = res.diagnostics.length
        ? res.diagnostics
            .map(function (d) {
              return d.message;
            })
            .join('\n')
        : '';
      toast(
        res.diagnostics.length
          ? 'PDF با ' + res.diagnostics.length + ' هشدار ساخته شد'
          : 'PDF ساخته شد و در حال دانلود است',
      );
    } catch (err) {
      diagEl.textContent = err.message;
      toast('ساخت PDF ناموفق: ' + err.message, true);
    }
  });
  function download(text, name, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  var sampleEl = document.getElementById('sampleData');
  sampleEl.value = JSON.stringify(sampleData, null, 2);
  sampleEl.addEventListener('input', function () {
    try {
      sampleData = JSON.parse(sampleEl.value);
      diagEl.textContent = '';
      renderFieldPicker();
      renderCanvas();
      renderPreview();
    } catch (err) {
      diagEl.textContent = 'دادهٔ JSON نامعتبر';
    }
  });
  // keep editor-global shortcuts (Ctrl+Z/D/K…) out of free-text fields so
  // typing keeps its native undo/redo — same guard docName/palette already use
  var stopKeys = function (e) {
    e.stopPropagation();
  };
  sampleEl.addEventListener('keydown', stopKeys);
  var liveUrlEl = document.getElementById('liveUrl');
  if (liveUrlEl) liveUrlEl.addEventListener('keydown', stopKeys);

  // --- theme + values toggles (§8A) -------------------------------------------
  var THEME_KEY = 'pdfstudio.theme';
  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    document.getElementById('toggleTheme').textContent = theme === 'dark' ? '☀️' : '🌙';
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (err) {
      /* ignore */
    }
  }
  document.getElementById('toggleTheme').addEventListener('click', function () {
    applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  var storedTheme = null;
  try {
    storedTheme = window.localStorage.getItem(THEME_KEY);
  } catch (err) {
    /* ignore */
  }
  applyTheme(storedTheme === 'light' ? 'light' : 'dark');

  document.getElementById('toggleValues').addEventListener('click', function () {
    showValues = !showValues;
    document.getElementById('toggleValues').textContent = showValues ? '🔢 مقادیر' : '🏷 نام فیلد';
    renderCanvas();
  });

  // --- command palette (Ctrl+K, §8A) -------------------------------------------
  var paletteEl = document.getElementById('palette');
  var paletteInput = document.getElementById('paletteInput');
  var paletteListEl = document.getElementById('paletteList');
  var paletteIndex = 0;
  function paletteCommands() {
    var cmds = [
      { label: 'افزودن متن', hint: 'toolbox', run: () => addElement('staticText') },
      { label: 'افزودن فیلد داده', hint: 'toolbox', run: () => addElement('dataField') },
      { label: 'افزودن مستطیل', hint: 'toolbox', run: () => addElement('rectangle') },
      { label: 'افزودن خط', hint: 'toolbox', run: () => addElement('line') },
      { label: 'افزودن بیضی', hint: 'toolbox', run: () => addElement('ellipse') },
      { label: 'افزودن تصویر', hint: 'toolbox', run: () => addElement('image') },
      { label: 'افزودن بارکد', hint: 'toolbox', run: () => addElement('barcode') },
      { label: 'افزودن QR', hint: 'toolbox', run: () => addElement('qrcode') },
      { label: 'افزودن چارت', hint: 'toolbox', run: () => addElement('chart') },
      {
        label: 'گالری قالب‌ها',
        hint: '🗂',
        run: () => document.getElementById('openGallery').click(),
      },
      { label: 'راهنمای کامل', hint: '؟', run: () => document.getElementById('openHelp').click() },
      {
        label: 'کوپایلوت هوش مصنوعی',
        hint: '✨',
        run: () => document.getElementById('openCopilot').click(),
      },
      {
        label: 'تور معرفی محیط',
        hint: '🧭',
        run: () => document.getElementById('startTour').click(),
      },
      {
        label: 'دانلود PDF',
        hint: 'خروجی',
        run: () => document.getElementById('downloadPdf').click(),
      },
      {
        label: 'پیش‌نمایش (نمایش/مخفی)',
        hint: 'نما',
        run: () => document.getElementById('togglePreview').click(),
      },
      {
        label: 'تم تیره/روشن',
        hint: 'نما',
        run: () => document.getElementById('toggleTheme').click(),
      },
      {
        label: 'مقادیر ↔ نام فیلدها',
        hint: 'نما',
        run: () => document.getElementById('toggleValues').click(),
      },
      { label: 'بزرگ‌نمایی', hint: 'زوم', run: () => setZoom(zoom + 0.1) },
      { label: 'کوچک‌نمایی', hint: 'زوم', run: () => setZoom(zoom - 0.1) },
      { label: 'زوم ۱:۱', hint: 'زوم', run: () => setZoom(1) },
      {
        label: 'خروجی JSON',
        hint: 'فایل',
        run: () => document.getElementById('exportJson').click(),
      },
      {
        label: 'ورود JSON',
        hint: 'فایل',
        run: () => document.getElementById('importJson').click(),
      },
      { label: 'سند نو', hint: 'فایل', run: () => document.getElementById('newDoc').click() },
    ];
    if (selected.length) {
      cmds.unshift(
        { label: 'کپی انتخاب (Ctrl+D)', hint: 'انتخاب', run: duplicateSelected },
        { label: 'حذف انتخاب', hint: 'انتخاب', run: deleteSelected },
        { label: 'بیار جلو', hint: 'انتخاب', run: () => reorderSelected(true) },
        { label: 'بفرست عقب', hint: 'انتخاب', run: () => reorderSelected(false) },
      );
    }
    return cmds;
  }
  function paletteFiltered() {
    var q = paletteInput.value.trim();
    var all = paletteCommands();
    if (!q) return all;
    return all.filter(function (c) {
      return c.label.indexOf(q) !== -1 || (c.hint && c.hint.indexOf(q) !== -1);
    });
  }
  function renderPalette() {
    var items = paletteFiltered();
    if (paletteIndex >= items.length) paletteIndex = Math.max(0, items.length - 1);
    paletteListEl.innerHTML = items
      .map(function (c, i) {
        return (
          '<li class="' +
          (i === paletteIndex ? 'active' : '') +
          '" data-i="' +
          i +
          '">' +
          esc(c.label) +
          '<small>' +
          esc(c.hint || '') +
          '</small></li>'
        );
      })
      .join('');
  }
  function openPalette() {
    paletteInput.value = '';
    paletteIndex = 0;
    renderPalette();
    paletteEl.classList.add('show');
    paletteInput.focus();
  }
  function closePalette() {
    paletteEl.classList.remove('show');
  }
  function runPalette(i) {
    var items = paletteFiltered();
    var cmd = items[i === undefined ? paletteIndex : i];
    closePalette();
    if (cmd) cmd.run();
  }
  document.getElementById('openPalette').addEventListener('click', openPalette);
  paletteInput.addEventListener('input', function () {
    paletteIndex = 0;
    renderPalette();
  });
  paletteInput.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      paletteIndex++;
      renderPalette();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      paletteIndex = Math.max(0, paletteIndex - 1);
      renderPalette();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      runPalette();
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });
  paletteListEl.addEventListener('click', function (e) {
    var li = e.target.closest ? e.target.closest('li') : null;
    if (li) runPalette(Number(li.dataset.i));
  });
  paletteEl.addEventListener('click', function (e) {
    if (e.target === paletteEl) closePalette();
  });

  function deleteSelected() {
    // one composite → deleting a whole selection is a single undo step
    var cmds = selected.map(function (sid) {
      return P.removeElementById(sid);
    });
    if (cmds.length) store.dispatch(P.composite(cmds));
    selected = [];
  }

  // --- help center (§8A) -------------------------------------------------------
  var HELP_SECTIONS = [
    {
      id: 'start',
      title: 'شروع سریع',
      icon: 'chart',
      html:
        '<h3>خوش آمدی 👋</h3>' +
        '<p class="lead">اینجا سند PDF طراحی می‌کنی — همان چیزی که روی بوم می‌بینی، دقیقاً همان PDF نهایی است.</p>' +
        '<h4>چهار مفهوم، نیم دقیقه</h4>' +
        '<table class="htable"><tr><th>مفهوم</th><th>یعنی چه؟</th></tr>' +
        '<tr><td><b>قالب</b></td><td>طرح سند تو؛ یک فایل JSON قابل ذخیره و انتقال.</td></tr>' +
        '<tr><td><b>الِمان</b></td><td>هرچیزی روی صفحه: متن، فیلد داده، شکل، بارکد، چارت…</td></tr>' +
        '<tr><td><b>دادهٔ نمونه</b></td><td>JSON آزمایشی که موقع طراحی جای دادهٔ واقعی می‌نشیند.</td></tr>' +
        '<tr><td><b>بایند</b></td><td>وصل‌کردن الِمان به داده: «این متن، اسم مشتری را نشان بده».</td></tr></table>' +
        '<h4>سریع‌ترین مسیر</h4>' +
        '<ol><li>دکمهٔ <b>قالب‌ها</b> → یک طرح آماده (یا «سند خالی») را لود کن.</li>' +
        '<li>الِمان‌ها را جابه‌جا کن، دابل‌کلیک کن و متن‌ها را عوض کن.</li>' +
        '<li><b>دانلود PDF</b> را بزن. تمام!</li></ol>' +
        '<div class="callout"><span class="c-ico">💡</span><span>روی هر دکمه‌ای ماوس را نگه داری، تولتیپ توضیح می‌دهد. برای دیدن همهٔ فرمان‌ها هم <kbd>Ctrl</kbd>+<kbd>K</kbd> را بزن.</span></div>',
    },
    {
      id: 'env',
      title: 'محیط برنامه',
      icon: 'rectangle',
      html:
        '<h3>یک دور دور محیط</h3>' +
        '<p class="lead">پنج ناحیهٔ اصلی — دکمهٔ «تور معرفی» بالای همین پنجره، تک‌تکشان را روی خود محیط نشانت می‌دهد.</p>' +
        '<table class="htable"><tr><th>ناحیه</th><th>چه‌کار می‌کند</th></tr>' +
        '<tr><td><b>نوار بالا</b></td><td>نام سند (کلیک کن و عوضش کن)، واگرد/ازنو، پیش‌نمایش، قالب‌ها، منوی فایل و دکمهٔ اصلی «دانلود PDF».</td></tr>' +
        '<tr><td><b>ریل ابزار</b></td><td>۹ ابزار. کلیک = افزودن به بوم؛ <b>کشیدن</b> = افزودن دقیقاً همان‌جا که رها کنی.</td></tr>' +
        '<tr><td><b>بوم</b></td><td>کاغذ توست؛ رندر زندهٔ خود موتور PDF.</td></tr>' +
        '<tr><td><b>پنل راست</b></td><td>سه تب: <b>طراحی</b> (خواص انتخاب + صفحه)، <b>لایه‌ها</b> (فهرست الِمان‌ها)، <b>داده</b> (JSON نمونه + چیپ‌های بایند).</td></tr>' +
        '<tr><td><b>نوار وضعیت</b></td><td>زوم، «جا بده»، اندازهٔ کاغذ، وضعیت انتخاب و نشانگر ذخیرهٔ خودکار.</td></tr></table>',
    },
    {
      id: 'first',
      title: 'اولین طراحی',
      icon: 'staticText',
      html:
        '<h3>اولین طراحی — ۱۰ قدم</h3>' +
        '<p class="lead">یک کارت تبریک با اسمِ از-داده و QR؛ همین ده قدم، ۹۰٪ کار با دیزاینر است.</p>' +
        '<ol>' +
        '<li><b>قالب‌ها</b> → «سند خالی».</li>' +
        '<li>تب طراحی → بخش صفحه → اندازه: <b>سفارشی…</b> → ابعاد <code>400×250</code> → جهت کاغذ: افقی.</li>' +
        '<li>ابزار <b>متن</b> را از ریل بکش وسط کارت.</li>' +
        '<li>دابل‌کلیک → بنویس «تبریک می‌گوییم!» → <kbd>Enter</kbd>.</li>' +
        '<li>بخش ظاهر: فونت ۲۲، ضخیم، رنگ دلخواه.</li>' +
        '<li>تب <b>داده</b> → چیپ <code>customer.name</code> را بکش زیر تیتر — فیلد بایندشده ساخته می‌شود.</li>' +
        '<li>ابزار <b>QR</b> را بکش گوشهٔ پایین؛ در «محتوا» بنویس <code>' +
        "'https://example.ir'" +
        '</code>.</li>' +
        '<li>یک <b>خط</b> تزئینی بکش؛ با فلش‌های کیبورد دقیقش کن.</li>' +
        '<li><b>دانلود PDF</b> — کارت واقعی با فونت فارسی!</li>' +
        '<li>فایل → <b>ذخیرهٔ طرح (JSON)</b>.</li></ol>',
    },
    {
      id: 'data',
      title: 'داده و بایند',
      icon: 'dataField',
      html:
        '<h3>داده و بایند — قلب ماجرا</h3>' +
        '<p class="lead">فیلدها را یک‌بار به داده وصل می‌کنی؛ بعداً همین قالب با هر داده‌ای PDF می‌سازد.</p>' +
        '<h4>سه راه بایند</h4>' +
        '<ol><li><b>کشیدن چیپ روی بوم</b> → فیلد جدید بایندشده (ساده‌ترین راه).</li>' +
        '<li><b>کشیدن چیپ روی یک الِمان</b> → بایند همان الِمان عوض می‌شود.</li>' +
        '<li><b>دستی</b>: الِمان را انتخاب کن → محتوا → بایند.</li></ol>' +
        '<h4>زبان عبارت</h4>' +
        '<table class="htable"><tr><th>می‌خواهی…</th><th>بنویس</th></tr>' +
        '<tr><td>مقدار ساده</td><td><code>customer.name</code></td></tr>' +
        '<tr><td>عضو آرایه</td><td><code>items[0].name</code></td></tr>' +
        '<tr><td>محاسبه</td><td><code>qty * price</code></td></tr>' +
        '<tr><td>جمع ستون</td><td><code>sum(items, qty * price)</code></td></tr>' +
        "<tr><td>متن ترکیبی</td><td><code>'جناب ' + customer.name</code></td></tr>" +
        "<tr><td>شرطی</td><td><code>total > 1000 ? 'ویژه' : 'عادی'</code></td></tr></table>" +
        '<div class="callout"><span class="c-ico">🔢</span><span>دکمهٔ «مقادیر» در نوار بالا، بوم را بین مقدار نمونه و {نام فیلد} سوییچ می‌کند تا ببینی چه‌چیزی به کجا وصل است.</span></div>',
    },
    {
      id: 'tools',
      title: 'ابزارها',
      icon: 'chart',
      html:
        '<h3>ابزارها — نکتهٔ هر کدام</h3>' +
        '<table class="htable"><tr><th>ابزار</th><th>نکته</th></tr>' +
        '<tr><td><b>متن</b></td><td>برای نوشته‌های ثابت. دابل‌کلیک = ویرایش سریع.</td></tr>' +
        '<tr><td><b>فیلد داده</b></td><td>خروجی از داده می‌آید. دابل‌کلیک = ویرایش بایند.</td></tr>' +
        '<tr><td><b>مستطیل/بیضی/خط</b></td><td>قاب، پس‌زمینه و جداکننده؛ رنگ در بخش «ظاهر».</td></tr>' +
        '<tr><td><b>تصویر</b></td><td>«آدرس» = URL یا data-URI داخل کوتیشن؛ «برازش» = contain/cover/fill.</td></tr>' +
        '<tr><td><b>بارکد</b></td><td>Code128 (متن/عدد)، Code39، EAN-13 (دقیقاً ۱۲ یا ۱۳ رقم معتبر). متن خوانا زیر میله‌ها روشن است.</td></tr>' +
        '<tr><td><b>QR</b></td><td>هر متنی، معمولاً URL — واقعاً اسکن می‌شود؛ با گوشی امتحان کن!</td></tr>' +
        '<tr><td><b>چارت</b></td><td>«دیتاست» = اسم آرایه (مثل <code>items</code>)، «دسته‌ها» = فیلد برچسب، «مقادیر» = عبارت عددی. ۷ نوع نمودار.</td></tr></table>',
    },
    {
      id: 'layout',
      title: 'چیدمان حرفه‌ای',
      icon: 'line',
      html:
        '<h3>چیدمان مثل حرفه‌ای‌ها</h3>' +
        '<ul>' +
        '<li><b>Snap هوشمند</b>: موقع درگ به شبکه و لبهٔ الِمان‌های دیگر می‌چسبد؛ خط قرمز = هم‌ترازی. <kbd>Alt</kbd> = خاموش.</li>' +
        '<li><b>جابه‌جایی دقیق</b>: فلش‌ها ۱pt، با <kbd>Shift</kbd> ۱۰pt.</li>' +
        '<li><b>چندانتخابی</b>: <kbd>Shift</kbd>+کلیک یا کشیدن کادر روی جای خالی بوم.</li>' +
        '<li><b>هم‌ترازی و توزیع</b>: با ۲+ انتخاب، دکمه‌هایش در تب طراحی ظاهر می‌شود.</li>' +
        '<li><b>نوار شناور</b>: بالای هر انتخاب — کپی، جلو/عقب، حذف.</li>' +
        '<li><b>لایه‌ها</b>: وقتی چیزها روی هم‌اند، از تب لایه‌ها دقیق انتخاب کن.</li>' +
        '<li><b>زوم</b>: <kbd>Ctrl</kbd>+چرخ موس؛ «۱:۱» اندازهٔ واقعی چاپ، «جا بده» کل صفحه.</li></ul>',
    },
    {
      id: 'templates',
      title: 'قالب‌ها',
      icon: 'image',
      html:
        '<h3>قالب‌های آماده</h3>' +
        '<p class="lead">۱۲ طرح با پیش‌نمایش زندهٔ واقعی — کلیک کنی، قالب + دادهٔ نمونه‌اش با هم لود می‌شود.</p>' +
        '<p>سند خالی، فاکتور فروش، پیش‌فاکتور، رسید پرداخت، گزارش فروش (با چارت)، سربرگ نامه، برچسب محصول، لیست بسته‌بندی، کارت ویزیت، منوی رستوران، گزارش کارکرد و گواهی‌نامه.</p>' +
        '<div class="callout"><span class="c-ico">🎨</span><span>بهترین راه یادگیری: یک قالب را لود کن و ببین الِمان‌هایش چطور بایند شده‌اند — بعد به سلیقهٔ خودت تغییرش بده.</span></div>',
    },
    {
      id: 'page',
      title: 'صفحه و خروجی',
      icon: 'qrcode',
      html:
        '<h3>تنظیم صفحه و خروجی گرفتن</h3>' +
        '<h4>صفحه (تب طراحی → بخش صفحه)</h4>' +
        '<ul><li><b>اندازه</b>: A4/A5/A3/Letter/Legal یا <b>سفارشی…</b> (به پونت؛ هر میلی‌متر ≈ <code>2.83pt</code> — مثلاً ۱۰×۶ سانتی‌متر ≈ <code>283×170</code>).</li>' +
        '<li><b>جهت کاغذ</b>: عمودی/افقی.</li>' +
        '<li><b>نوشتار</b>: RTL برای فارسی (پیش‌فرض).</li></ul>' +
        '<h4>خروجی</h4>' +
        '<table class="htable"><tr><th>کار</th><th>چطور</th></tr>' +
        '<tr><td>PDF نهایی</td><td>دکمهٔ آبی «دانلود PDF» — فونت فارسی embed شده، متن قابل جست‌وجو.</td></tr>' +
        '<tr><td>ذخیره/بازکردن طرح</td><td>منوی فایل → JSON. این فایل قالب کامل توست.</td></tr>' +
        '<tr><td>ذخیرهٔ خودکار</td><td>همیشه روشن («ذخیره شد ✓» بالای صفحه)؛ مرورگر را ببندی، برمی‌گردد.</td></tr></table>',
    },
    {
      id: 'keys',
      title: 'میان‌برها',
      icon: 'barcode',
      html:
        '<h3>میان‌برهای کیبورد</h3>' +
        '<table class="htable"><tr><th>کلید</th><th>کار</th></tr>' +
        '<tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></td><td>واگرد / ازنو</td></tr>' +
        '<tr><td><kbd>Ctrl</kbd>+<kbd>D</kbd></td><td>کپی انتخاب</td></tr>' +
        '<tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>پالت فرمان</td></tr>' +
        '<tr><td><kbd>Delete</kbd></td><td>حذف انتخاب</td></tr>' +
        '<tr><td>فلش‌ها / <kbd>Shift</kbd>+فلش‌ها</td><td>جابه‌جایی ۱ / ۱۰ پونت</td></tr>' +
        '<tr><td><kbd>Escape</kbd></td><td>لغو انتخاب / بستن پنجره‌ها</td></tr>' +
        '<tr><td><kbd>Shift</kbd>+کلیک</td><td>افزودن/کم‌کردن از انتخاب</td></tr>' +
        '<tr><td><kbd>Alt</kbd> حین درگ</td><td>بدون snap</td></tr>' +
        '<tr><td><kbd>Ctrl</kbd>+چرخ موس</td><td>زوم</td></tr>' +
        '<tr><td>دابل‌کلیک</td><td>ویرایش سریع متن/بایند</td></tr></table>',
    },
    {
      id: 'faq',
      title: 'رفع اشکال',
      icon: 'ellipse',
      html:
        '<h3>مشکلات رایج</h3>' +
        '<table class="htable"><tr><th>مشکل</th><th>راه‌حل</th></tr>' +
        '<tr><td>فیلد خالی نشان می‌دهد</td><td>مسیر بایند با دادهٔ نمونه نمی‌خواند — تب داده و چیپ‌ها را چک کن.</td></tr>' +
        '<tr><td>«دادهٔ JSON نامعتبر»</td><td>در JSON کاما یا کوتیشن جا افتاده.</td></tr>' +
        '<tr><td>هشدار زیر تب داده</td><td>خطاهای غیرمهلک موتور — سند ساخته می‌شود، آن بخش جا می‌افتد.</td></tr>' +
        '<tr><td>EAN-13 نمی‌آید</td><td>دقیقاً ۱۲ رقم (کنترل خودکار) یا ۱۳ رقم معتبر بده.</td></tr>' +
        '<tr><td>طرحم پرید!</td><td>ذخیرهٔ خودکار همیشه هست — رفرش کن، برمی‌گردد.</td></tr></table>' +
        '<div class="callout"><span class="c-ico">📚</span><span>مرجع کامل‌تر در مخزن: <code>docs/designer-guide.md</code></span></div>',
    },
  ];

  var helpEl = document.getElementById('help');
  var helpNavEl = document.getElementById('helpNav');
  var helpContentEl = document.getElementById('helpContent');
  var helpBuilt = false;
  function showHelpSection(id) {
    var sec = HELP_SECTIONS.filter(function (x) {
      return x.id === id;
    })[0];
    if (!sec) return;
    helpNavEl.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.sec === id);
    });
    helpContentEl.innerHTML = sec.html;
    helpContentEl.scrollTop = 0;
  }
  function openHelp() {
    if (!helpBuilt) {
      helpBuilt = true;
      helpNavEl.innerHTML = HELP_SECTIONS.map(function (sec) {
        return (
          '<button data-sec="' + sec.id + '">' + typeIcon(sec.icon, 15) + sec.title + '</button>'
        );
      }).join('');
      helpNavEl.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (b) showHelpSection(b.dataset.sec);
      });
      showHelpSection('start');
    }
    helpEl.classList.add('show');
  }
  document.getElementById('openHelp').addEventListener('click', openHelp);
  document.getElementById('closeHelp').addEventListener('click', function () {
    helpEl.classList.remove('show');
  });
  helpEl.addEventListener('click', function (e) {
    if (e.target === helpEl) helpEl.classList.remove('show');
  });

  // --- interactive tour (§8A) ---------------------------------------------------
  var TOUR_STEPS = [
    {
      sel: '.toolrail',
      title: 'جعبه‌ابزار',
      body: '۹ ابزار طراحی. کلیک کن تا به بوم اضافه شود، یا بگیر و بکش تا دقیقاً همان‌جا که می‌خواهی بنشیند.',
    },
    {
      sel: '#page',
      title: 'بوم — کاغذ تو',
      body: 'چیزی که اینجا می‌بینی همان PDF نهایی است. الِمان‌ها را بکش، از گوشه اندازه بده، دابل‌کلیک کن تا متن/بایند را عوض کنی.',
    },
    {
      sel: '.tab[data-tab="design"]',
      title: 'تب طراحی',
      body: 'خواص الِمان انتخاب‌شده: مکان و اندازه، محتوا، ظاهر — به‌علاوهٔ تنظیمات کاغذ (اندازه، جهت).',
    },
    {
      sel: '.tab[data-tab="layers"]',
      title: 'تب لایه‌ها',
      body: 'فهرست همهٔ الِمان‌های صفحه. وقتی چیزها روی هم‌اند، از اینجا دقیق انتخابشان کن.',
    },
    {
      sel: '.tab[data-tab="data"]',
      title: 'تب داده',
      body: 'دادهٔ نمونهٔ JSON و چیپ‌های فیلد. چیپ را بکش روی بوم تا فیلد بایندشده ساخته شود.',
    },
    {
      sel: '#openGallery',
      title: 'قالب‌های آماده',
      body: '۱۲ طرح حرفه‌ای با پیش‌نمایش زنده — از «سند خالی» تا فاکتور و گزارش. بهترین نقطهٔ شروع.',
    },
    {
      sel: '.statusbar',
      title: 'نوار وضعیت',
      body: 'زوم و «جا بده»، اندازهٔ کاغذ، وضعیت انتخاب و نشانگر ذخیرهٔ خودکار — همیشه جلوی چشمت.',
    },
    {
      sel: '#downloadPdf',
      title: 'دانلود PDF',
      body: 'هر وقت آماده بودی، همین دکمه: PDF واقعی با فونت فارسی. راستی: Ctrl+K همهٔ فرمان‌ها را دارد و دکمهٔ «؟» همین راهنما را.',
    },
  ];
  var tourEl = document.getElementById('tour');
  var tourRingEl = document.getElementById('tourRing');
  var tourCardEl = document.getElementById('tourCard');
  var tourIndex = 0;
  function tourStep(i) {
    tourIndex = Math.max(0, Math.min(TOUR_STEPS.length - 1, i));
    var step = TOUR_STEPS[tourIndex];
    var target = document.querySelector(step.sel);
    if (!target) return endTour();
    var r = target.getBoundingClientRect();
    var pad = 6;
    tourRingEl.style.top = r.top - pad + 'px';
    tourRingEl.style.left = r.left - pad + 'px';
    tourRingEl.style.width = r.width + pad * 2 + 'px';
    tourRingEl.style.height = r.height + pad * 2 + 'px';

    var dots = TOUR_STEPS.map(function (_, di) {
      return '<i class="' + (di === tourIndex ? 'on' : '') + '"></i>';
    }).join('');
    var last = tourIndex === TOUR_STEPS.length - 1;
    tourCardEl.innerHTML =
      '<div class="t-step">قدم ' +
      (tourIndex + 1) +
      ' از ' +
      TOUR_STEPS.length +
      '</div>' +
      '<h4>' +
      step.title +
      '</h4>' +
      '<p>' +
      step.body +
      '</p>' +
      '<div class="t-foot"><div class="t-dots">' +
      dots +
      '</div>' +
      '<button class="linkish" data-tour="skip">رد کردن</button>' +
      (tourIndex > 0 ? '<button data-tour="prev">قبلی</button>' : '') +
      '<button class="primary" data-tour="next">' +
      (last ? 'شروع کن! 🚀' : 'بعدی') +
      '</button></div>';

    // place the card near the target, clamped to the viewport
    var cw = 330;
    var ch = tourCardEl.offsetHeight || 170;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var top = r.bottom + 14;
    if (top + ch > vh - 12) top = Math.max(12, r.top - ch - 14);
    var left = r.left + r.width / 2 - cw / 2;
    left = Math.max(12, Math.min(vw - cw - 12, left));
    tourCardEl.style.top = top + 'px';
    tourCardEl.style.left = left + 'px';
  }
  function startTour() {
    helpEl.classList.remove('show');
    tourEl.classList.add('show');
    tourStep(0);
  }
  function endTour() {
    tourEl.classList.remove('show');
    try {
      window.localStorage.setItem('pdfstudio.toured', '1');
    } catch (err) {
      /* ignore */
    }
  }
  document.getElementById('startTour').addEventListener('click', startTour);
  tourCardEl.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.dataset.tour === 'skip') endTour();
    else if (b.dataset.tour === 'prev') tourStep(tourIndex - 1);
    else if (b.dataset.tour === 'next') {
      if (tourIndex === TOUR_STEPS.length - 1) endTour();
      else tourStep(tourIndex + 1);
    }
  });
  tourEl.addEventListener('click', function (e) {
    if (e.target === tourEl) endTour();
  });

  // first visit: offer the tour once (deferred so it never blocks scripting)
  setTimeout(function () {
    var toured = null;
    try {
      toured = window.localStorage.getItem('pdfstudio.toured');
    } catch (err) {
      /* ignore */
    }
    if (!toured) startTour();
  }, 700);

  // --- template gallery (§8A-B) ----------------------------------------------
  var galleryEl = document.getElementById('gallery');
  var galleryCardsEl = document.getElementById('galleryCards');
  var galleryRendered = false;
  function renderGallery() {
    if (galleryRendered) return;
    galleryRendered = true;
    var templates = window.PDFSTUDIO_TEMPLATES || [];
    galleryCardsEl.innerHTML = '';
    templates.forEach(function (entry) {
      var card = document.createElement('button');
      card.className = 'tpl-card';
      card.dataset.template = entry.id;
      var thumbHtml = '';
      try {
        // live WYSIWYG thumbnail: the engine renders page 1 of the template
        var res = P.renderToSvg(entry.template, { data: entry.data });
        thumbHtml = res.pages[0] || '';
      } catch (err) {
        thumbHtml = '';
      }
      card.innerHTML =
        '<div class="tpl-thumb">' +
        thumbHtml +
        '</div><div class="tpl-meta"><strong>' +
        esc(entry.name) +
        '</strong><span>' +
        esc(entry.desc || '') +
        '</span></div>';
      var svg = card.querySelector('.tpl-thumb svg');
      if (svg) {
        var w = Number(svg.getAttribute('width')) || 595;
        svg.style.transform = 'scale(' + 220 / w + ')';
      }
      card.title = 'لود قالب «' + entry.name + '» همراه دادهٔ نمونه‌اش';
      card.addEventListener('click', function () {
        loadGalleryTemplate(entry);
      });
      galleryCardsEl.appendChild(card);
    });
    upgradeTooltips(galleryCardsEl);
  }
  function loadGalleryTemplate(entry) {
    sampleData = JSON.parse(JSON.stringify(entry.data || {}));
    sampleEl.value = JSON.stringify(sampleData, null, 2);
    renderFieldPicker();
    loadTemplate(JSON.parse(JSON.stringify(entry.template)));
    galleryEl.classList.remove('show');
    setTab('design');
    toast('قالب «' + entry.name + '» لود شد');
  }
  document.getElementById('openGallery').addEventListener('click', function () {
    renderGallery();
    galleryEl.classList.add('show');
  });
  document.getElementById('closeGallery').addEventListener('click', function () {
    galleryEl.classList.remove('show');
  });
  galleryEl.addEventListener('click', function (e) {
    if (e.target === galleryEl) galleryEl.classList.remove('show');
  });

  // --- autosave / new document ----------------------------------------------
  var DRAFT_KEY = 'pdfstudio.draft';
  var autosaveTimer = null;
  function autosave() {
    clearTimeout(autosaveTimer);
    var stateEl = document.getElementById('saveState');
    stateEl.textContent = 'در حال ذخیره…';
    stateEl.classList.remove('saved');
    autosaveTimer = setTimeout(function () {
      try {
        var json = P.serializeTemplate(store.getState());
        window.localStorage.setItem(DRAFT_KEY, json);
        recordHistory(json);
        stateEl.textContent = 'ذخیره شد ✓';
        stateEl.classList.add('saved');
      } catch (err) {
        stateEl.textContent = '';
      }
    }, 400);
  }

  // --- version history (ROADMAP ۲.۴) -----------------------------------------
  var HISTORY_KEY = 'pdfstudio.history';
  var HISTORY_MAX = 20;
  function readHistory() {
    try {
      return JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
    } catch (err) {
      return [];
    }
  }
  function recordHistory(json) {
    try {
      var hist = readHistory();
      if (hist.length && hist[0].json === json) return; // unchanged
      hist.unshift({
        ts: Date.now(),
        name: store.getState().metadata.name || 'سند بی‌نام',
        count: store.getState().bands[0].elements.length,
        json: json,
      });
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, HISTORY_MAX)));
    } catch (err) {
      /* storage unavailable — history is best-effort */
    }
  }
  var historyEl = document.getElementById('history');
  function renderHistory() {
    var hist = readHistory();
    var listEl = document.getElementById('historyList');
    if (!hist.length) {
      listEl.innerHTML =
        '<div class="layers-empty">هنوز نسخه‌ای ذخیره نشده — چند تغییر بده و برگرد.</div>';
      return;
    }
    listEl.innerHTML = hist
      .map(function (h, i) {
        var d = new Date(h.ts);
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        return (
          '<div class="hist-row"><div><b>' +
          esc(h.name) +
          '</b><small>' +
          hh +
          ':' +
          mm +
          ' · ' +
          h.count +
          ' الِمان</small></div><span class="spacer"></span>' +
          '<button data-hist="' +
          i +
          '">بازگردانی</button></div>'
        );
      })
      .join('');
  }
  document.getElementById('openHistory').addEventListener('click', function () {
    renderHistory();
    historyEl.classList.add('show');
  });
  document.getElementById('closeHistory').addEventListener('click', function () {
    historyEl.classList.remove('show');
  });
  historyEl.addEventListener('click', function (e) {
    if (e.target === historyEl) return historyEl.classList.remove('show');
    var btn = e.target.closest ? e.target.closest('[data-hist]') : null;
    if (!btn) return;
    var entry = readHistory()[Number(btn.dataset.hist)];
    if (!entry) return;
    var res = P.importTemplate(entry.json);
    if (res.success) {
      loadTemplate(res.value);
      historyEl.classList.remove('show');
      toast('نسخهٔ انتخابی بازگردانی شد');
    } else {
      toast('این نسخه قابل بازگردانی نیست');
    }
  });

  // --- AI copilot (ROADMAP ۳.۲–۳.۳) ---------------------------------------------
  var copilotEl = document.getElementById('copilot');
  /** Replace the whole template as ONE undoable command. */
  function replaceTemplateCmd(next, prev) {
    return {
      type: 'copilot',
      apply: function () {
        return next;
      },
      invert: function () {
        return replaceTemplateCmd(prev, next);
      },
    };
  }
  /** Free-tier friendly presets for the OpenAI-compatible path (ROADMAP ۳). */
  var CP_PRESETS = {
    groq: {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      needsKey: true,
    },
    gemini: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.0-flash',
      needsKey: true,
    },
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      needsKey: true,
    },
    ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:14b', needsKey: false },
    claude: { baseUrl: '', model: 'claude-sonnet-5', needsKey: true },
    custom: { baseUrl: '', model: '', needsKey: true },
  };
  var CP_CFG_KEY = 'pdfstudio.copilot';
  function applyCpPreset(name, keepFields) {
    var preset = CP_PRESETS[name] || CP_PRESETS.custom;
    var isClaude = name === 'claude';
    document.getElementById('cpBaseUrlRow').style.display = isClaude ? 'none' : '';
    document.getElementById('cpModelRow').style.display = isClaude ? 'none' : '';
    document.getElementById('cpKeyRow').style.display = preset.needsKey ? '' : 'none';
    if (!keepFields) {
      document.getElementById('cpBaseUrl').value = preset.baseUrl;
      document.getElementById('cpModel').value = preset.model;
    }
    document.getElementById('cpKey').placeholder = isClaude ? 'sk-ant-…' : 'کلید سرویس…';
  }
  document.getElementById('cpProvider').addEventListener('change', function (e) {
    applyCpPreset(e.target.value, false);
    saveCpConfig();
  });
  function saveCpConfig() {
    try {
      window.localStorage.setItem(
        CP_CFG_KEY,
        JSON.stringify({
          provider: document.getElementById('cpProvider').value,
          baseUrl: document.getElementById('cpBaseUrl').value,
          model: document.getElementById('cpModel').value,
          key: document.getElementById('cpKey').value,
        }),
      );
    } catch (err) {
      /* ignore */
    }
  }
  function loadCpConfig() {
    try {
      var raw = window.localStorage.getItem(CP_CFG_KEY);
      if (!raw) {
        // migrate the pre-provider-select storage: a bare Claude key
        var legacyKey = window.localStorage.getItem('pdfstudio.apikey');
        var name = legacyKey ? 'claude' : 'groq';
        document.getElementById('cpProvider').value = name;
        applyCpPreset(name, false);
        if (legacyKey) document.getElementById('cpKey').value = legacyKey;
        return;
      }
      var cfg = JSON.parse(raw);
      document.getElementById('cpProvider').value = cfg.provider || 'groq';
      applyCpPreset(cfg.provider || 'groq', true);
      document.getElementById('cpBaseUrl').value = cfg.baseUrl || '';
      document.getElementById('cpModel').value = cfg.model || '';
      document.getElementById('cpKey').value = cfg.key || '';
    } catch (err) {
      document.getElementById('cpProvider').value = 'groq';
      applyCpPreset('groq', false);
    }
  }
  ['cpBaseUrl', 'cpModel', 'cpKey'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', saveCpConfig);
  });

  function copilotProvider() {
    // test/self-host hook first, then the user's Claude key
    if (window.PDFSTUDIO_COPILOT_PROVIDER) return window.PDFSTUDIO_COPILOT_PROVIDER;
    var name = document.getElementById('cpProvider').value;
    var key = document.getElementById('cpKey').value.trim();
    saveCpConfig();
    if (name === 'claude') {
      return key ? new P.ClaudeProvider({ apiKey: key }) : null;
    }
    var baseUrl = document.getElementById('cpBaseUrl').value.trim();
    var model = document.getElementById('cpModel').value.trim();
    if (!baseUrl || !model) return null;
    var needsKey = (CP_PRESETS[name] || CP_PRESETS.custom).needsKey;
    if (needsKey && !key) return null;
    var opts = { baseUrl: baseUrl, model: model };
    if (key) opts.apiKey = key;
    return new P.OpenAICompatibleProvider(opts);
  }
  document.getElementById('openCopilot').addEventListener('click', function () {
    loadCpConfig();
    copilotEl.classList.add('show');
    document.getElementById('cpPrompt').focus();
  });
  document.getElementById('closeCopilot').addEventListener('click', function () {
    copilotEl.classList.remove('show');
  });
  copilotEl.addEventListener('click', function (e) {
    if (e.target === copilotEl) copilotEl.classList.remove('show');
  });
  // keep canvas shortcuts (Delete, arrows…) out of the copilot inputs
  ['cpPrompt', 'cpKey', 'cpBaseUrl', 'cpModel'].forEach(function (id) {
    document.getElementById(id).addEventListener('keydown', function (e) {
      e.stopPropagation();
    });
  });

  var cpBusy = false;
  document.getElementById('cpRun').addEventListener('click', function () {
    if (cpBusy) return;
    var statusEl = document.getElementById('cpStatus');
    var mode = document.getElementById('cpMode').value;
    var promptText = document.getElementById('cpPrompt').value.trim();
    if (mode === 'bind') {
      promptText =
        'Re-bind the dataField/table/chart elements of the current template to the sample data by matching names and meanings. Keep layout untouched; only change value/dataset/categories/series sources. ' +
        (promptText ? 'Extra instructions: ' + promptText : '');
    }
    if (!promptText) {
      statusEl.textContent = 'اول بنویس چه می‌خواهی.';
      return;
    }
    var provider = copilotProvider();
    if (!provider) {
      statusEl.textContent =
        'تنظیمات سرویس کامل نیست — Groq و Gemini کلید رایگان می‌دهند؛ Ollama هم بدون کلید است.';
      return;
    }
    cpBusy = true;
    statusEl.textContent = 'در حال ساخت… (ممکن است تا یک دقیقه طول بکشد)';
    var opts = { prompt: promptText, provider: provider, sampleData: sampleData };
    if (mode !== 'new') opts.currentTemplate = store.getState();
    P.generateTemplate(opts)
      .then(function (res) {
        cpBusy = false;
        if (!res.success) {
          statusEl.textContent = /429|rate.?limit/i.test(res.error)
            ? 'سقف رایگان سرویس فعلاً پر شد — یکی دو دقیقه صبر کن و دوباره بزن، یا مدل سبک‌تر (مثل llama-3.1-8b-instant) یا سرویس Gemini را انتخاب کن.'
            : 'نشد: ' + res.error.slice(0, 180);
          return;
        }
        bumpUid(res.template);
        store.dispatch(replaceTemplateCmd(res.template, store.getState()));
        selected = [];
        copilotEl.classList.remove('show');
        statusEl.textContent = '';
        setTab('design');
        toast(
          'کوپایلوت قالب را ' +
            (mode === 'new' ? 'ساخت' : 'به‌روزرسانی کرد') +
            ' (تلاش ' +
            res.attempts +
            ') — Ctrl+Z برمی‌گرداند',
        );
      })
      .catch(function (err) {
        cpBusy = false;
        statusEl.textContent = 'خطا: ' + (err && err.message ? err.message : err);
      });
  });

  // --- share as link (ROADMAP ۲.۱) --------------------------------------------
  function toBase64Url(str) {
    return window
      .btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  function fromBase64Url(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(window.atob(s)));
  }
  document.getElementById('shareLink').addEventListener('click', function () {
    var payload = toBase64Url(P.serializeTemplate(store.getState()));
    var url = window.location.href.split('#')[0] + '#t=' + payload;
    // Reflect the link in the address bar WITHOUT firing hashchange — setting
    // location.hash would reload the doc from the hash and wipe undo history.
    window.history.replaceState(null, '', url);
    var done = function () {
      toast('لینک اشتراک کپی شد (' + Math.round(url.length / 1024) + 'KB)');
    };
    if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
      window.navigator.clipboard.writeText(url).then(done, done);
    } else {
      done();
    }
  });
  function tryLoadFromHash() {
    var hash = window.location.hash || '';
    if (hash.indexOf('#t=') !== 0) return false;
    try {
      var res = P.importTemplate(fromBase64Url(hash.slice(3)));
      if (!res.success) return false;
      loadTemplate(res.value);
      toast('قالب از لینک اشتراک لود شد');
      return true;
    } catch (err) {
      return false;
    }
  }
  window.addEventListener('hashchange', tryLoadFromHash);

  // --- live data from a URL (ROADMAP ۲.۲) --------------------------------------
  document.getElementById('liveFetch').addEventListener('click', function () {
    var url = document.getElementById('liveUrl').value.trim();
    if (!url) return toast('اول آدرس API را بنویس');
    window
      .fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (typeof json !== 'object' || json === null) throw new Error('پاسخ JSON نیست');
        sampleData = json;
        sampleEl.value = JSON.stringify(sampleData, null, 2);
        renderFieldPicker();
        renderCanvas();
        renderPreview();
        toast('دادهٔ زنده دریافت شد');
      })
      .catch(function (err) {
        toast('دریافت داده ناموفق بود: ' + err.message);
      });
  });
  function restoreDraft() {
    try {
      var raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      var res = P.importTemplate(raw);
      if (!res.success) return false;
      loadTemplate(res.value);
      return true;
    } catch (err) {
      return false;
    }
  }
  var fileMenu = document.getElementById('fileMenu');
  document.getElementById('fileMenuBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    fileMenu.classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (!fileMenu.contains(e.target)) fileMenu.classList.remove('open');
  });
  fileMenu.addEventListener('click', function () {
    fileMenu.classList.remove('open');
  });

  document.getElementById('newDoc').addEventListener('click', function () {
    if (!window.confirm('سند جدید؟ طرح فعلی پاک می‌شود (پیش‌نویس هم).')) return;
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      /* ignore */
    }
    loadTemplate(blankTemplate());
    toast('سند خالی آماده است — از جعبه‌ابزار شروع کن');
  });

  // --- keyboard ------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    var editing =
      document.activeElement &&
      (document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'SELECT');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    } else if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      // while a text field is focused, leave undo/redo to the browser so the
      // user's typing — not the document — is what gets reverted
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    } else if (
      !editing &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'd' &&
      selected.length
    ) {
      e.preventDefault();
      duplicateSelected();
    } else if (
      !editing &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'c' &&
      selected.length
    ) {
      e.preventDefault();
      copySelected();
    } else if (
      !editing &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'x' &&
      selected.length
    ) {
      e.preventDefault();
      copySelected();
      deleteSelected();
    } else if (
      !editing &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'v' &&
      clipboard.length
    ) {
      e.preventDefault();
      pasteClipboard();
    } else if (e.key === 'Escape') {
      if (tourEl.classList.contains('show')) return endTour();
      if (helpEl.classList.contains('show')) return helpEl.classList.remove('show');
      if (historyEl.classList.contains('show')) return historyEl.classList.remove('show');
      if (copilotEl.classList.contains('show')) return copilotEl.classList.remove('show');
      selected = [];
      renderInspector();
      renderCanvas();
    } else if (!editing && selected.length && /^Arrow/.test(e.key)) {
      e.preventDefault();
      var step = e.shiftKey ? 10 : 1;
      var dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      var dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      store.dispatch(moveManyCmd(selected.slice(), dx, dy));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length && !editing) {
      e.preventDefault();
      deleteSelected();
    }
  });

  // --- wiring --------------------------------------------------------------
  var docNameEl = document.getElementById('docName');
  docNameEl.addEventListener('change', function () {
    var prev = store.getState().metadata.name;
    if (docNameEl.value.trim() && docNameEl.value !== prev) {
      store.dispatch(renameCmd(docNameEl.value.trim(), prev));
    }
  });
  docNameEl.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') docNameEl.blur();
  });

  function rerender() {
    document.getElementById('undo').disabled = !store.canUndo();
    document.getElementById('redo').disabled = !store.canRedo();
    document.getElementById('pageDir').value = store.getState().page.direction;
    var pg = store.getState().page;
    var isCustom = typeof pg.size !== 'string';
    document.getElementById('pageSize').value = isCustom ? '__custom__' : pg.size;
    document.getElementById('pageOrient').value = pg.orientation;
    document.getElementById('customSizeRow').style.display = isCustom ? '' : 'none';
    if (isCustom) {
      var wInp = document.getElementById('pageW');
      var hInp = document.getElementById('pageH');
      if (document.activeElement !== wInp) wInp.value = Math.round(pg.size.width);
      if (document.activeElement !== hInp) hInp.value = Math.round(pg.size.height);
    }
    if (document.activeElement !== docNameEl) {
      docNameEl.value = store.getState().metadata.name || 'سند بی‌نام';
    }
    renderCanvas();
    renderLayers();
    renderStatus();
    renderPreview();
    autosave();
  }
  function bumpUid(t) {
    t.bands.forEach(function (band) {
      (band.elements || []).forEach(function (el) {
        var m = /^el-(\d+)$/.exec(el.id);
        if (m) uid = Math.max(uid, Number(m[1]) + 1);
      });
    });
  }
  function loadTemplate(t) {
    bumpUid(t);
    activeBand = 0;
    store = new P.DocumentStore(t);
    store.subscribe(function () {
      rerender();
      renderInspector();
    });
    selected = [];
    rerender();
    renderInspector();
  }
  bumpUid(store.getState());
  store.subscribe(function () {
    rerender();
    renderInspector();
  });
  // Accessible modal dialogs (design-review 1.4): trap Tab inside an open
  // dialog and restore focus to the opener on close. Driven by a MutationObserver
  // on each modal's `class`, so the many scattered `.show` toggles need no changes.
  function installModalA11y() {
    var BACKDROPS = '.help-backdrop, .gallery-backdrop, .palette-backdrop';
    var FOCUSABLE =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
      'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    var lastOutside = null;
    document.addEventListener('focusin', function (e) {
      if (!(e.target.closest && e.target.closest(BACKDROPS))) lastOutside = e.target;
    });
    function visibleFocusables(modal) {
      return Array.prototype.filter.call(modal.querySelectorAll(FOCUSABLE), function (el) {
        return el.offsetWidth > 0 || el.offsetHeight > 0;
      });
    }
    ['help', 'gallery', 'copilot', 'history', 'palette'].forEach(function (id) {
      var modal = document.getElementById(id);
      if (!modal) return;
      var restoreTo = null;
      function onKey(e) {
        if (e.key !== 'Tab') return;
        var f = visibleFocusables(modal);
        if (!f.length) return;
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      new MutationObserver(function () {
        var open = modal.classList.contains('show');
        if (open && !modal.__trap) {
          modal.__trap = true;
          restoreTo = lastOutside;
          modal.addEventListener('keydown', onKey);
          if (!modal.contains(document.activeElement)) {
            var f = visibleFocusables(modal);
            if (f.length) f[0].focus();
          }
        } else if (!open && modal.__trap) {
          modal.__trap = false;
          modal.removeEventListener('keydown', onKey);
          var active = document.activeElement;
          var stillHere = !active || active === document.body || modal.contains(active);
          if (stillHere && restoreTo && document.contains(restoreTo) && restoreTo.focus) {
            restoreTo.focus();
          }
          restoreTo = null;
        }
      }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    });
  }
  installModalA11y();
  upgradeTooltips(document);
  renderFieldPicker();
  if (!tryLoadFromHash() && !restoreDraft()) {
    rerender();
    renderInspector();
  }
})();
