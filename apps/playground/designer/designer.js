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
  var enteredGroup = null; // id of the container we "entered" (see renderCanvas)
  var selected = []; // ids, last item drives the inspector
  var enteredGroup = null; // container id whose children the canvas exposes, or null
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
    // a group: dashed frame around two stacked children
    container:
      '<path d="M3.5 6V4.5A1 1 0 0 1 4.5 3.5H6M14 3.5h1.5a1 1 0 0 1 1 1V6M16.5 14v1.5a1 1 0 0 1-1 1H14M6 16.5H4.5a1 1 0 0 1-1-1V14"/><rect x="6.5" y="6.5" width="7" height="7" rx="1"/>',
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
  // toast(msg)                         → info
  // toast(msg, true)                   → error (back-compat)
  // toast(msg, { type, action:{label,onClick} })  → typed + optional inline action
  var TOAST_ICONS = {
    info: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10 9.2v4"/><path d="M10 6.6h.01"/></svg>',
    success:
      '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="m6.5 10.2 2.3 2.3 4.7-5"/></svg>',
    error:
      '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10 6.3v4.4"/><path d="M10 13.6h.01"/></svg>',
  };
  function hideToast() {
    var el = document.getElementById('toast');
    el.classList.remove('show');
    el.style.pointerEvents = 'none';
  }
  function toast(msg, opts) {
    var o = typeof opts === 'boolean' ? { type: opts ? 'error' : 'info' } : opts || {};
    var type = o.type || 'info';
    var el = document.getElementById('toast');
    el.classList.remove('error', 'success', 'info');
    el.classList.add(type);
    el.innerHTML =
      '<span class="t-ico">' +
      (TOAST_ICONS[type] || TOAST_ICONS.info) +
      '</span><span class="t-msg"></span>';
    el.querySelector('.t-msg').textContent = msg; // text node — safe for dynamic messages
    var hasAction = o.action && o.action.label && typeof o.action.onClick === 'function';
    if (hasAction) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 't-action';
      btn.textContent = o.action.label;
      btn.addEventListener('click', function () {
        hideToast();
        o.action.onClick();
      });
      el.appendChild(btn);
      el.style.pointerEvents = 'auto';
    } else {
      el.style.pointerEvents = 'none';
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, hasAction ? 6000 : type === 'error' ? 5000 : 2400);
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
  // Test seam: smoke.js drives the real UI and then asserts on the store.
  window.__designerStore = store;

  // --- commands ------------------------------------------------------------
  // The whole editing vocabulary lives in the engine (`core/src/document/`), so
  // every mutation here is one of its reversible commands — nothing rebuilds an
  // apply/invert pair locally.
  // Inspector updaters are written in the mutate-and-return style
  // (`e.text = v; return e`), but `modifyElement` requires a pure updater — it
  // captures the pre-apply element for undo, so mutating it in place would
  // corrupt the inverse. Hand every updater its own shallow copy.
  function pure(updater) {
    return function (e) {
      return updater(Object.assign({}, e));
    };
  }
  function update(id, updater) {
    if (!P.findElement(store.getState(), id)) return;
    store.dispatch(P.modifyElement(id, pure(updater)));
  }
  /** Apply the same mutation to every selected element in one undo step. */
  function updateSelected(updater) {
    var ids = selected.length ? selected : [lastSelected()];
    var cmds = ids
      .filter(function (sid) {
        return sid && P.findElement(store.getState(), sid);
      })
      .map(function (sid) {
        return P.modifyElement(sid, pure(updater));
      });
    if (cmds.length) store.dispatch(P.composite(cmds));
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
    store.dispatch(P.setElementsBounds(next));
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
    store.dispatch(P.setElementsBounds(next));
  }

  /** Bring the selection above (or send below) everything else. */
  function reorderSelected(front) {
    var t = store.getState();
    var zs = getActiveBand(t).elements.map(function (e) {
      return e.zIndex || 1;
    });
    var z = front ? Math.max.apply(null, zs) + 1 : Math.min.apply(null, zs) - 1;
    var cmds = selected.map(function (id) {
      return P.setElementZIndex(id, z);
    });
    if (cmds.length) store.dispatch(P.composite(cmds));
  }

  /** A locked element can be selected and inspected, but not moved or deleted. */
  function isLocked(id) {
    var loc = P.findElement(store.getState(), id);
    return !!(loc && loc.element.locked);
  }
  function unlockedSelection() {
    return selected.filter(function (id) {
      return !isLocked(id);
    });
  }
  var lockToastAt = 0;
  /** Explain why nothing moved — but only once per few seconds, not per frame. */
  function lockedNudge() {
    if (Date.now() - lockToastAt < 3000) return;
    lockToastAt = Date.now();
    toast('این الِمان قفل است — از پنل لایه‌ها یا اینسپکتور بازش کن');
  }

  /** The single selected element, when it is a group (container). */
  function selectedContainer() {
    if (selected.length !== 1) return null;
    var loc = P.findElement(store.getState(), selected[0]);
    return loc && loc.element.type === 'container' ? loc.element : null;
  }

  /** Wrap the selection in a group; the new group becomes the selection. */
  function groupSelected() {
    if (selected.length < 2) return;
    var id = 'grp-' + uid++;
    store.dispatch(P.groupElements(selected.slice(), id));
    if (!P.findElement(store.getState(), id)) return; // nothing was groupable
    selected = [id];
    renderCanvas();
    renderInspector();
    toast('گروه ساخته شد', { type: 'success' });
  }

  /**
   * Step inside a group so its children are directly editable on the canvas.
   * Leaving is Escape, a click on empty canvas, or the breadcrumb.
   */
  function enterGroup(containerId) {
    var loc = P.findElement(store.getState(), containerId);
    if (!loc || loc.element.type !== 'container') return;
    enteredGroup = containerId;
    selected = [];
    renderCanvas();
    renderInspector();
    renderLayers();
  }
  function exitGroup() {
    if (!enteredGroup) return false;
    var id = enteredGroup;
    enteredGroup = null;
    selected = P.findElement(store.getState(), id) ? [id] : [];
    renderCanvas();
    renderInspector();
    renderLayers();
    return true;
  }

  /** Dissolve the selected group; its children become the selection. */
  function ungroupSelected() {
    var group = selectedContainer();
    if (!group) return;
    var childIds = group.children.map(function (c) {
      return c.id;
    });
    store.dispatch(P.ungroupContainer(group.id));
    selected = childIds;
    renderCanvas();
    renderInspector();
    toast('گروه باز شد', { type: 'success' });
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
    var t0 = store.getState();
    var host = enteredGroup ? P.findElement(t0, enteredGroup) : null;
    var els = host ? host.element.children : getActiveBand(t0).elements;
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

  /** Dispatch an element add, wiring table cell styles + dataset atomically. */
  function dispatchAddElement(el) {
    var bandId = curBandId();
    if (el.type === 'table') {
      store.dispatch(
        P.composite([
          P.ensureStyles(TABLE_STYLES),
          P.ensureDataset(el.dataset),
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
      toast(items.length + ' مورد کپی شد', { type: 'success' });
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
    var bandId = curBandId();
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
  var bandBoxEl = document.getElementById('bandBox');
  var bandBoxLabelEl = document.getElementById('bandBoxLabel');
  var bandRestEl = document.getElementById('bandRest');
  var overflowInfoEl = document.getElementById('overflowInfo');
  var diagInfoEl = document.getElementById('diagInfo');
  diagInfoEl.addEventListener('click', function () {
    revealDiagnostics();
  });
  var canvasErrorEl = document.getElementById('canvasError');
  var canvasErrorDetailEl = document.getElementById('canvasErrorDetail');
  var canvasErrorUndoEl = document.getElementById('canvasErrorUndo');
  canvasErrorUndoEl.addEventListener('click', function () {
    store.undo();
  });
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
  /**
   * Where new elements land: the group we have stepped into, if any, otherwise
   * the active band. Both are valid `parentId`s for the engine's addElement.
   */
  function curBandId() {
    if (enteredGroup && P.findElement(store.getState(), enteredGroup)) return enteredGroup;
    return getActiveBand(store.getState()).id;
  }
  function isRowBand(band) {
    return band.type === 'detail' || band.type === 'groupHeader' || band.type === 'groupFooter';
  }
  /**
   * The strip a band actually owns, mirroring the engine's own `bandHeight()`:
   * a `fixed` band is exactly its declared value however tall its content is;
   * an `auto` band grows to its content, clamped by min/max. Anything painted
   * past this line still reaches the PDF — on top of the following band.
   */
  function resolveBandHeight(band, contentBottom) {
    var h = band.height || { mode: 'auto' };
    if (h.mode === 'fixed') return h.value;
    var min = h.min == null ? 0 : h.min;
    var max = h.max == null ? Infinity : h.max;
    return Math.min(max, Math.max(min, contentBottom));
  }
  /** Background/watermark bands span the page by contract — overflow means nothing. */
  function isPageWideBand(band) {
    return band.type === 'background' || band.type === 'watermark';
  }
  /**
   * Element types the engine auto-grows past their declared box: it measures the
   * text, wraps it, and paints every line. That is deliberate engine behaviour,
   * not a bug — but it breaks the designer's WYSIWYG promise, because the box
   * you drew (and the handles on it) stop matching what lands on the paper.
   */
  var TEXT_AUTOGROW = {
    staticText: true,
    dataField: true,
    richText: true,
    pageField: true,
  };
  /** The height the engine actually paints an element at, in pt (0 if unknown). */
  function paintedHeightOf(t, id) {
    try {
      var doc = P.layoutDocument(displayTemplate(activeBandTemplate(t)), {
        data: activeBandData(t),
      });
      var h = 0;
      ((doc.pages[0] && doc.pages[0].elements) || []).forEach(function (le) {
        if (le && le.id === id && le.bounds) h = Math.max(h, le.bounds.height);
      });
      return h;
    } catch (e) {
      return 0;
    }
  }
  // --- live diagnostics (designer-ux 0.3) -----------------------------------

  /** Visit every element in a band subtree, including container children. */
  function eachElement(els, fn) {
    (els || []).forEach(function (el) {
      fn(el);
      if (el.children) eachElement(el.children, fn);
      if (el.itemTemplate) eachElement(el.itemTemplate, fn);
    });
  }
  /** Every expression an element carries, as `{id, source}` pairs. */
  function eachElementExpression(t, fn) {
    (t.bands || []).forEach(function (band) {
      eachElement(band.elements, function (el) {
        var push = function (expr) {
          if (expr && expr.source) fn(el.id, expr.source);
        };
        push(el.value);
        push(el.visibleWhen);
        push(el.printWhen);
        push(el.source); // image
        push(el.categories); // chart
        (el.series || []).forEach(function (s) {
          push(s.values);
        });
        (el.columns || []).forEach(function (c) {
          if (c.detail) push(c.detail.content);
          if (c.footer) push(c.footer.content);
        });
        (el.conditionalStyles || []).forEach(function (cs) {
          push(cs.when);
        });
      });
    });
  }
  /** The band index that owns an element id, or -1. */
  function bandIndexOf(t, id) {
    var found = -1;
    (t.bands || []).forEach(function (band, i) {
      eachElement(band.elements, function (el) {
        if (el.id === id && found === -1) found = i;
      });
    });
    return found;
  }
  /**
   * Trace a diagnostic back to the element that produced it. Since 0.6 the
   * engine names it outright, which is exact; the two fallbacks below still earn
   * their keep for diagnostics raised outside any element scope — a dataset
   * declaration, a band group key, a report variable — where the message may
   * still quote an id. Returns null when it cannot tell, so the row simply has
   * no jump button rather than selecting the wrong element.
   */
  function diagElementId(t, d) {
    if (d.elementId && P.findElement(t, d.elementId)) return d.elementId;
    var quoted = /'([^']+)'/.exec(d.message || '');
    if (quoted && P.findElement(t, quoted[1])) return quoted[1];
    if (!d.source) return null;
    var hit = null;
    var ambiguous = false;
    eachElementExpression(t, function (id, src) {
      if (src !== d.source) return;
      if (hit === null) hit = id;
      else if (hit !== id) ambiguous = true;
    });
    return ambiguous ? null : hit;
  }
  /** Select an element wherever it lives, switching bands and tabs to reach it. */
  function gotoElement(id) {
    var t = store.getState();
    var bi = bandIndexOf(t, id);
    if (bi >= 0 && bi !== activeBand) setActiveBand(bi);
    setTab('design');
    selectById(id);
  }

  /** Where the active band's painted content ends, in band-relative pt. */
  function bandContentBottom(t) {
    try {
      var doc = P.layoutDocument(displayTemplate(activeBandTemplate(t)), {
        data: activeBandData(t),
      });
      return laidContentBottom(doc.pages[0], t.page.margins);
    } catch (e) {
      return 0;
    }
  }
  /** Deepest painted edge on a laid page, measured from the top margin. */
  function laidContentBottom(page, m) {
    var bottom = 0;
    ((page && page.elements) || []).forEach(function (le) {
      if (le && le.bounds) bottom = Math.max(bottom, le.bounds.y + le.bounds.height - m.top);
    });
    return bottom;
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

  /** Patch the band at a canvas index — the engine addresses bands by id. */
  function patchBandAt(index, patch) {
    var band = store.getState().bands[index];
    return band ? P.patchBand(band.id, patch) : P.NO_OP;
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
      setCanvasError(null);
    } catch (err) {
      // A structurally broken element (a chart with no series, a band with no
      // height — the shapes an import or a copilot answer can produce) throws
      // out of layout. Blanking the sheet in silence reads as a crashed app, so
      // say what happened and offer the way back (designer-ux 0.2).
      pageSvgEl.innerHTML = '';
      setCanvasError(err);
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
    // Band extent + overflow (designer-ux 0.1). The canvas paints only the
    // active band, so without this a 60pt band looks like it owns the whole
    // sheet and content spilling past its height silently lands on top of the
    // band that follows. `laidBottom` keys off the painted pieces, so a text
    // element that wrapped to six lines counts at its real height, not its
    // declared one.
    var laidBottom = {};
    var contentBottom = 0;
    try {
      (doc && doc.pages && doc.pages[0] ? doc.pages[0].elements : []).forEach(function (le) {
        if (!le || le.id == null || !le.bounds) return;
        var bottom = le.bounds.y + le.bounds.height - m.top;
        contentBottom = Math.max(contentBottom, bottom);
        laidBottom[le.id] = Math.max(laidBottom[le.id] || 0, bottom);
      });
    } catch (e) {
      /* ignore */
    }
    var pageWide = isPageWideBand(band);
    var bandH = resolveBandHeight(band, contentBottom);
    var overflowBy = pageWide ? 0 : Math.max(0, contentBottom - bandH);
    renderBandExtent(m, size, bandH, overflowBy, pageWide);
    // Which elements get overlays: normally the band's own, but after
    // double-clicking a group we "enter" it and expose its children instead, so
    // they can be selected and dragged directly on the canvas (Figma-style).
    // Their bounds are parent-relative, so the overlay carries the group offset;
    // the drag/resize commands need no adjustment, since they write back
    // parent-relative bounds too.
    var entered = enteredGroup ? P.findElement(t, enteredGroup) : null;
    if (enteredGroup && (!entered || entered.element.type !== 'container')) {
      enteredGroup = null; // the group was deleted or ungrouped under us
      entered = null;
    }
    var overlaySource = entered ? entered.element.children : band.elements;
    var offX = entered ? entered.element.bounds.x : 0;
    var offY = entered ? entered.element.bounds.y : 0;
    // Append overlays in paint order (zIndex ascending, array order as the
    // tiebreak) so the visually top-most element is last in the DOM and wins
    // the click on overlapping elements — matching what the SVG shows.
    var ordered = overlaySource.slice().sort(function (a, b) {
      return (a.zIndex || 1) - (b.zIndex || 1);
    });
    ordered.forEach(function (el) {
      var node = document.createElement('div');
      node.className =
        'el' + (isSelected(el.id) ? ' selected' : '') + (el.locked ? ' is-locked' : '');
      node.dataset.id = el.id;
      // keyboard access (design-review 1.3): Tab reaches elements, Enter/Space selects.
      // aria-label carries the type for AT; no native `title` so the styled
      // [data-tip] tooltips stay the single tooltip mechanism (design-review 3.9)
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', faName(el.type));
      node.setAttribute('aria-pressed', isSelected(el.id) ? 'true' : 'false');
      var b = el.bounds;
      node.style.left = (m.left + offX + b.x) * zoom + 'px';
      node.style.top = (m.top + offY + b.y) * zoom + 'px';
      node.style.width = Math.max(4, b.width * zoom) + 'px';
      node.style.height = Math.max(4, b.height * zoom) + 'px';
      // an element that paints nothing is invisible on the canvas — give it a
      // dashed outline + a hint so it's findable and its purpose is clear
      // reaches past the band edge → it will be painted over the next band (0.1)
      if (!pageWide) {
        var elBottom = laidBottom[el.id];
        if (elBottom == null) elBottom = offY + b.y + b.height;
        if (elBottom > bandH + 0.01) node.classList.add('is-overflow');
      }
      // text auto-grew past the box that was drawn (0.4). The overlay keeps the
      // *editable* bounds — that is what drag/resize writes back — so the spill
      // is drawn as a ghost below it instead of stretching the box and lying
      // about which rectangle the handles control.
      if (TEXT_AUTOGROW[el.type] && laidBottom[el.id] != null) {
        var spill = laidBottom[el.id] - (offY + b.y) - b.height;
        if (spill > 0.5) {
          node.classList.add('is-clipped');
          var ghost = document.createElement('div');
          ghost.className = 'el-clip-ghost';
          ghost.style.height = spill * zoom + 'px';
          node.appendChild(ghost);
        }
      }
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
      // The engine rotates around the element's centre, so the overlay has to
      // as well — otherwise a rotated element is painted one way and its
      // selection box sits somewhere else (designer-ux 1.8).
      if (el.rotation) node.style.transform = 'rotate(' + el.rotation + 'deg)';
      pageEl.appendChild(node);
      // a locked element offers no handles — the affordance would lie
      if (selected.length === 1 && isSelected(el.id) && !el.locked) {
        RESIZE_DIRS.forEach(function (dir) {
          var handle = document.createElement('div');
          handle.className = 'handle h-' + dir;
          handle.dataset.resize = el.id;
          handle.dataset.dir = dir;
          node.appendChild(handle);
        });
        var rot = document.createElement('div');
        rot.className = 'rot-handle';
        rot.dataset.rotate = el.id;
        rot.title = 'چرخش — Shift برای پله‌های ۱۵ درجه';
        node.appendChild(rot);
      }
    });
    document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
    document.getElementById('canvasHint').classList.toggle('show', band.elements.length === 0);
    renderQuickbar(t, m);
  }

  /**
   * Live diagnostics (0.3). These used to appear only after clicking "download
   * PDF", so a mistyped binding or an undeclared dataset stayed hidden until
   * export. They are computed over the WHOLE document, not the active band —
   * a broken footer must not read as "no problems" while you edit the header.
   *
   * Debounced, because this is a second layout pass on every change. It is
   * cheaper than the preview pane's existing 120ms `renderToSvg` (layout AND
   * paint), so the canvas stays responsive during a drag.
   */
  var liveDiags = [];
  var diagTimer = null;
  var DIAG_DEBOUNCE = 150;
  function scheduleDiagnostics() {
    clearTimeout(diagTimer);
    diagTimer = setTimeout(runDiagnostics, DIAG_DEBOUNCE);
  }
  function runDiagnostics() {
    try {
      liveDiags = P.layoutDocument(store.getState(), { data: sampleData }).diagnostics || [];
    } catch (err) {
      // a template layout cannot even complete — the canvas bar (0.2) explains
      // it in Persian; here it belongs in the list as an error too
      liveDiags = [{ severity: 'error', message: err && err.message ? err.message : String(err) }];
    }
    renderDiagnostics();
  }
  var DIAG_ICONS = {
    warning:
      '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M10 3.6 2.8 16.4h14.4L10 3.6Z"/><path d="M10 8.6v3"/><path d="M10 14h.01"/></svg>',
    error:
      '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="10" cy="10" r="7"/><path d="M10 6.5v4"/><path d="M10 13.5h.01"/></svg>',
  };
  function renderDiagnostics() {
    var t = store.getState();
    var errors = liveDiags.filter(function (d) {
      return d.severity === 'error';
    }).length;
    // status-bar counter
    if (!liveDiags.length) {
      diagInfoEl.hidden = true;
    } else {
      diagInfoEl.hidden = false;
      diagInfoEl.classList.toggle('has-error', errors > 0);
      diagInfoEl.innerHTML = DIAG_ICONS[errors ? 'error' : 'warning'];
      diagInfoEl.appendChild(
        document.createTextNode(
          liveDiags.length + (errors ? ' خطا' : ' هشدار'), // Latin digits (design-review 2.3)
        ),
      );
    }
    // the list itself
    diagEl.innerHTML = '';
    liveDiags.forEach(function (d) {
      var row = document.createElement('div');
      row.className = 'dg-row sev-' + (d.severity === 'error' ? 'error' : 'warning');
      row.innerHTML = DIAG_ICONS[d.severity === 'error' ? 'error' : 'warning'];
      var msg = document.createElement('span');
      msg.className = 'dg-msg';
      msg.textContent = d.message; // engine text — never innerHTML
      row.appendChild(msg);
      var id = diagElementId(t, d);
      if (id) {
        var go = document.createElement('button');
        go.type = 'button';
        go.className = 'dg-goto';
        go.textContent = 'برو';
        go.title = 'انتخابِ الِمانِ مربوطه روی بوم';
        go.addEventListener('click', function () {
          gotoElement(id);
        });
        row.appendChild(go);
      }
      diagEl.appendChild(row);
    });
  }
  /**
   * Replace the list with one designer-side message (bad sample JSON, a failed
   * import, a failed export). It goes through the same list so there is one
   * place diagnostics appear, and the next edit recomputes over it.
   */
  function showLocalDiag(severity, message) {
    liveDiags = [{ severity: severity, message: message }];
    renderDiagnostics();
  }
  /** Jump to the list when the counter is clicked. */
  function revealDiagnostics() {
    setTab('data');
    if (isDrawerLayout()) setPanelOpen(true);
    var first = diagEl.querySelector('.dg-row');
    if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Show or clear the canvas render failure (0.2). `null` clears it. The undo
   * button is the only real way out of a template the engine cannot lay out, so
   * it is hidden when there is nothing to undo rather than lying about it.
   */
  function setCanvasError(err) {
    if (!err) {
      canvasErrorEl.hidden = true;
      return;
    }
    canvasErrorEl.hidden = false;
    // textContent, not innerHTML — the message carries engine/template strings
    canvasErrorDetailEl.textContent = err && err.message ? err.message : String(err);
    canvasErrorUndoEl.hidden = !store.canUndo();
  }

  /**
   * Draw the active band's own strip on the canvas and hatch the rest of the
   * sheet, so the band stops looking like it owns the whole page (0.1).
   */
  function renderBandExtent(m, size, bandH, overflowBy, pageWide) {
    if (pageWide) {
      // painted across the page by contract — a boundary would be a lie
      bandBoxEl.style.display = 'none';
      bandRestEl.style.display = 'none';
      setOverflowInfo(0);
      return;
    }
    var left = m.left * zoom;
    var top = m.top * zoom;
    var height = Math.max(0, bandH) * zoom;
    bandBoxEl.style.display = '';
    bandBoxEl.style.left = left + 'px';
    bandBoxEl.style.top = top + 'px';
    bandBoxEl.style.width = Math.max(0, size.width - m.left - m.right) * zoom + 'px';
    bandBoxEl.style.height = height + 'px';
    bandBoxEl.classList.toggle('is-overflow', overflowBy > 0);
    bandBoxLabelEl.textContent = Math.round(bandH) + 'pt';
    var restTop = top + height;
    var restH = size.height * zoom - restTop;
    bandRestEl.style.display = restH > 1 ? '' : 'none';
    bandRestEl.style.left = '0px';
    bandRestEl.style.top = restTop + 'px';
    bandRestEl.style.width = size.width * zoom + 'px';
    bandRestEl.style.height = Math.max(0, restH) + 'px';
    setOverflowInfo(overflowBy);
  }
  var WARN_ICON =
    '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10 3.6 2.8 16.4h14.4L10 3.6Z"/><path d="M10 8.6v3"/><path d="M10 14h.01"/></svg>';
  /** Sub-pt spill is float noise from text metrics, not an authoring mistake. */
  function setOverflowInfo(overflowBy) {
    if (!(overflowBy > 0.5)) {
      overflowInfoEl.hidden = true;
      return;
    }
    overflowInfoEl.hidden = false;
    overflowInfoEl.innerHTML = WARN_ICON;
    overflowInfoEl.appendChild(
      document.createTextNode('سرریز باند ' + Math.round(overflowBy) + 'pt'),
    );
  }
  // one click = grow the band to its content, as a single undoable command
  overflowInfoEl.addEventListener('click', function () {
    var t = store.getState();
    var band = getActiveBand(t);
    if (isPageWideBand(band)) return;
    var next = Math.ceil(bandContentBottom(t));
    if (!(next > 0)) return;
    store.dispatch(patchBandAt(activeBand, { height: { mode: 'fixed', value: next } }));
    toast('ارتفاع باند به ' + next + 'pt رسید', {
      type: 'success',
      action: {
        label: 'واگرد',
        onClick: function () {
          store.undo();
        },
      },
    });
  });

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
    if (el.name) return el.name; // author-given name always wins (§8A)
    if (el.type === 'staticText' && el.text) return el.text;
    if (el.value && el.value.source) return el.value.source;
    if (el.type === 'chart') return faName(el.type) + ' · ' + (el.chartKind || '');
    if (el.type === 'container') return faName(el.type) + ' · ' + el.children.length + ' الِمان';
    return faName(el.type);
  }
  var LOCK_ICON =
    '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
    '<rect x="4.5" y="9" width="11" height="7.5" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>';
  var UNLOCK_ICON =
    '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
    '<rect x="4.5" y="9" width="11" height="7.5" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 5.8-1"/></svg>';
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
          '" title="کلیک: انتخاب · Shift+کلیک: افزودن به انتخاب · دابل‌کلیک روی نام: تغییر نام" data-id="' +
          esc(el.id) +
          '"><span class="l-ico">' +
          typeIcon(el.type, 13) +
          '</span><span class="l-name" data-rename="' +
          esc(el.id) +
          '">' +
          esc(layerLabel(el)) +
          '</span><span class="l-type">' +
          esc(el.type) +
          '</span>' +
          '<button class="l-lock" data-lock="' +
          esc(el.id) +
          '" aria-pressed="' +
          (el.locked ? 'true' : 'false') +
          '" title="' +
          (el.locked ? 'باز کردنِ قفل' : 'قفل کردن — جلوگیری از جابه‌جایی/حذفِ ناخواسته') +
          '">' +
          (el.locked ? LOCK_ICON : UNLOCK_ICON) +
          '</button></div>'
        );
      })
      .join('');
    upgradeTooltips(layersEl);
  }

  // --- style library (§8A-B) -------------------------------------------------
  // Named styles are the "edit once, update everywhere" mechanism. The engine
  // owns the commands; this panel just lists them and dispatches.
  var styleListEl = document.getElementById('styleList');
  /** How many elements (incl. table cells) point at a style — the "usage" count. */
  function styleUsage(t, styleId) {
    var n = 0;
    var visit = function (el) {
      if (el.styleId === styleId) n++;
      if (el.type === 'table') {
        if (el.rowStripeStyleId === styleId) n++;
        (el.columns || []).forEach(function (col) {
          ['header', 'footer', 'detail'].forEach(function (slot) {
            if (col[slot] && col[slot].styleId === styleId) n++;
          });
        });
      }
      (P.elementChildren(el) || []).forEach(visit);
    };
    t.bands.forEach(function (band) {
      band.elements.forEach(visit);
    });
    return n;
  }
  function renderStyleList() {
    if (!styleListEl) return;
    var t = store.getState();
    var styles = t.styles || [];
    if (!styles.length) {
      styleListEl.innerHTML =
        '<div class="layers-empty">هنوز سبکِ نامداری نداری.<br>' +
        'یک جدول اضافه کن یا از الِمان انتخاب‌شده سبک بساز.</div>';
      return;
    }
    styleListEl.innerHTML = styles
      .map(function (s) {
        var used = styleUsage(t, s.id);
        var size = (s.typography && s.typography.fontSize) || '';
        return (
          '<div class="st-row" data-style="' +
          esc(s.id) +
          '"><span class="st-name" data-style-rename="' +
          esc(s.id) +
          '" title="دابل‌کلیک برای تغییر نام">' +
          esc(s.name || s.id) +
          '</span>' +
          '<span class="st-meta">' +
          (size ? size + 'pt · ' : '') +
          used +
          ' کاربرد</span>' +
          '<button class="st-act" data-style-apply="' +
          esc(s.id) +
          '" title="اعمال بر انتخاب">اعمال</button>' +
          '<button class="st-act" data-style-dup="' +
          esc(s.id) +
          '" title="ساختن یک نسخهٔ جدید از این سبک">تکثیر</button>' +
          '<button class="st-act danger" data-style-del="' +
          esc(s.id) +
          '" title="حذفِ سبک و پاک کردنِ ارجاع‌هایش">حذف</button></div>'
        );
      })
      .join('');
    upgradeTooltips(styleListEl);
  }
  if (styleListEl)
    styleListEl.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target : null;
      if (!target) return;
      var applyId = target.dataset.styleApply;
      if (applyId) {
        var ids = selected.slice();
        if (!ids.length) return toast('اول یک الِمان انتخاب کن');
        store.dispatch(
          P.composite(
            ids.map(function (id) {
              return P.patchElement(id, { styleId: applyId });
            }),
          ),
        );
        return toast('سبک اعمال شد', { type: 'success' });
      }
      var dupId = target.dataset.styleDup;
      if (dupId) {
        var src = (store.getState().styles || []).filter(function (s) {
          return s.id === dupId;
        })[0];
        var newId = dupId + '-' + uid++;
        store.dispatch(
          P.duplicateStyle(dupId, newId, (src && src.name ? src.name : dupId) + ' (کپی)'),
        );
        return;
      }
      var delId = target.dataset.styleDel;
      if (delId) {
        var n = styleUsage(store.getState(), delId);
        store.dispatch(P.removeStyle(delId));
        toast(n ? 'سبک حذف شد — ' + n + ' ارجاع پاک شد' : 'سبک حذف شد', {
          action: {
            label: 'واگرد',
            onClick: function () {
              store.undo();
            },
          },
        });
      }
    });
  if (styleListEl)
    styleListEl.addEventListener('dblclick', function (e) {
      var nameEl = e.target.closest ? e.target.closest('[data-style-rename]') : null;
      if (!nameEl) return;
      var id = nameEl.dataset.styleRename;
      var current = (store.getState().styles || []).filter(function (s) {
        return s.id === id;
      })[0];
      if (!current) return;
      var input = document.createElement('input');
      input.className = 'l-rename';
      input.value = current.name || id;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      var done = false;
      var commit = function (save) {
        if (done) return;
        done = true;
        var v = input.value.trim();
        if (save && v && v !== current.name) store.dispatch(P.updateStyle(id, { name: v }));
        else renderStyleList();
      };
      input.addEventListener('keydown', function (ev) {
        ev.stopPropagation();
        if (ev.key === 'Enter') commit(true);
        if (ev.key === 'Escape') commit(false);
      });
      input.addEventListener('blur', function () {
        commit(true);
      });
    });

  // --- saved components / snippets (§8A-B) -----------------------------------
  // Snippets are a *library* artifact, not part of the template, so they live in
  // localStorage; the engine only captures and inserts them.
  var SNIPPET_KEY = 'pdfstudio.snippets.v1';
  var snippetListEl = document.getElementById('snippetList');
  function loadSnippets() {
    try {
      var raw = localStorage.getItem(SNIPPET_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  function saveSnippets(list) {
    try {
      localStorage.setItem(SNIPPET_KEY, JSON.stringify(list));
    } catch (e) {
      toast('ذخیرهٔ جزء ممکن نشد (فضای مرورگر پر است)', { type: 'error' });
    }
  }
  function renderSnippetList() {
    if (!snippetListEl) return;
    var list = loadSnippets();
    if (!list.length) {
      snippetListEl.innerHTML =
        '<div class="layers-empty">هنوز جزئی ذخیره نکردی.<br>' +
        'چند الِمان را انتخاب کن و «ذخیرهٔ انتخاب» را بزن.</div>';
      return;
    }
    snippetListEl.innerHTML = list
      .map(function (s) {
        return (
          '<div class="st-row"><span class="st-name">' +
          esc(s.name || s.id) +
          '</span><span class="st-meta">' +
          Math.round(s.width) +
          '×' +
          Math.round(s.height) +
          'pt</span>' +
          '<button class="st-act" data-snip-insert="' +
          esc(s.id) +
          '" title="درج در باندِ فعال">درج</button>' +
          '<button class="st-act danger" data-snip-del="' +
          esc(s.id) +
          '" title="حذف از کتابخانه">حذف</button></div>'
        );
      })
      .join('');
    upgradeTooltips(snippetListEl);
  }
  var saveSnippetBtn = document.getElementById('saveSnippet');
  if (saveSnippetBtn)
    saveSnippetBtn.addEventListener('click', function () {
      if (!selected.length) return toast('اول الِمان‌هایی را انتخاب کن');
      var name = prompt('نامِ این جزء؟', 'جزء ' + (loadSnippets().length + 1));
      if (name === null) return;
      var snippet = P.createSnippet(store.getState(), selected.slice(), {
        id: 'snip-' + Date.now(),
        name: (name || '').trim() || 'جزء بی‌نام',
      });
      if (!snippet) return toast('چیزی برای ذخیره پیدا نشد', { type: 'error' });
      saveSnippets(loadSnippets().concat([snippet]));
      renderSnippetList();
      toast('جزء ذخیره شد', { type: 'success' });
    });
  if (snippetListEl)
    snippetListEl.addEventListener('click', function (e) {
      var target = e.target;
      var insertId = target.dataset && target.dataset.snipInsert;
      if (insertId) {
        var snippet = loadSnippets().filter(function (s) {
          return s.id === insertId;
        })[0];
        if (!snippet) return;
        // drop it into the first free spot so it never lands on existing content
        var spot = nextSpot(snippet.width, snippet.height);
        var prefix = 'el-' + uid;
        uid += countSnippetElements(snippet) + 1;
        store.dispatch(P.insertSnippet(curBandId(), snippet, { idPrefix: prefix, at: spot }));
        toast('جزء درج شد', { type: 'success' });
        return;
      }
      var delId = target.dataset && target.dataset.snipDel;
      if (delId) {
        saveSnippets(
          loadSnippets().filter(function (s) {
            return s.id !== delId;
          }),
        );
        renderSnippetList();
      }
    });
  /** Total elements in a snippet, subtree included — reserves that many ids. */
  function countSnippetElements(snippet) {
    var n = 0;
    var visit = function (el) {
      n++;
      (P.elementChildren(el) || []).forEach(visit);
    };
    (snippet.elements || []).forEach(visit);
    return n;
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
    var lockBtn = e.target.closest ? e.target.closest('[data-lock]') : null;
    if (lockBtn) {
      e.stopPropagation(); // toggling the lock must not also re-select the row
      var lockId = lockBtn.dataset.lock;
      store.dispatch(P.setElementLocked(lockId, !isLocked(lockId)));
      return;
    }
    var row = e.target.closest ? e.target.closest('.layer') : null;
    if (!row) return;
    selectById(row.dataset.id, e.shiftKey);
  });
  // double-click a layer name to rename it (Figma-style), Enter/blur commits
  layersEl.addEventListener('dblclick', function (e) {
    var nameEl = e.target.closest ? e.target.closest('[data-rename]') : null;
    if (!nameEl) return;
    var id = nameEl.dataset.rename;
    var loc = P.findElement(store.getState(), id);
    if (!loc) return;
    var input = document.createElement('input');
    input.className = 'l-rename';
    input.value = loc.element.name || layerLabel(loc.element);
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      var v = input.value.trim();
      if (save && v && v !== (loc.element.name || '')) store.dispatch(P.renameElement(id, v));
      else renderLayers();
    }
    input.addEventListener('keydown', function (ev) {
      ev.stopPropagation(); // don't let Delete/arrows reach the canvas shortcuts
      if (ev.key === 'Enter') commit(true);
      if (ev.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', function () {
      commit(true);
    });
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
  /**
   * The eight grips, and which edges each one moves. `x`/`y` mean "this handle
   * drags the left/top edge", `w`/`h` mean "it drags the right/bottom edge" —
   * so a corner does both and an edge handle does one.
   */
  var RESIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var RESIZE_EDGES = {
    nw: { left: true, top: true },
    n: { top: true },
    ne: { right: true, top: true },
    e: { right: true },
    se: { right: true, bottom: true },
    s: { bottom: true },
    sw: { left: true, bottom: true },
    w: { left: true },
  };
  var MIN_SIZE = 8;
  /**
   * Angle in degrees from an element's centre to the pointer. Screen y grows
   * downward, so `atan2` already increases clockwise — which is the direction
   * the model calls positive.
   */
  function pointerAngle(e, bounds) {
    var rect = pageEl.getBoundingClientRect();
    var m = store.getState().page.margins;
    var cx = rect.left + (m.left + bounds.x + bounds.width / 2) * zoom;
    var cy = rect.top + (m.top + bounds.y + bounds.height / 2) * zoom;
    return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
  }
  var drag = null;
  pageEl.addEventListener('mousedown', function (e) {
    var resizeId = e.target.dataset && e.target.dataset.resize;
    var rotateId = e.target.dataset && e.target.dataset.rotate;
    var elNode = e.target.closest ? e.target.closest('.el') : null;
    if (rotateId) {
      var rloc = P.findElement(store.getState(), rotateId);
      if (isLocked(rotateId)) return lockedNudge();
      if (!rloc) return;
      drag = {
        mode: 'rotate',
        id: rotateId,
        start: pointerAngle(e, rloc.element.bounds),
        rotation: rloc.element.rotation || 0,
        gkey: 'rot' + ++dragSeq,
      };
      e.preventDefault();
      return;
    }
    if (resizeId) {
      var loc = P.findElement(store.getState(), resizeId);
      if (isLocked(resizeId)) return lockedNudge();
      if (!loc) return;
      drag = {
        mode: 'resize',
        id: resizeId,
        dir: e.target.dataset.dir || 'se',
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
      // a locked element still selects (so it can be inspected/unlocked) but
      // never joins a drag — and a selection of only locked elements cannot move
      var movable = selected.filter(function (sid) {
        return !isLocked(sid);
      });
      if (!movable.length) {
        setTab('design');
        renderInspector();
        renderCanvas();
        lockedNudge();
        e.preventDefault();
        return;
      }
      var starts = {};
      movable.forEach(function (sid) {
        var l = P.findElement(store.getState(), sid);
        if (l) starts[sid] = Object.assign({}, l.element.bounds);
      });
      drag = {
        mode: 'move',
        ids: movable,
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
    } else if (enteredGroup) {
      // inside a group, empty canvas means "I am done in here"
      exitGroup();
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
    if (drag.mode === 'rotate') {
      var rloc = P.findElement(t, drag.id);
      if (!rloc) return;
      var deg = drag.rotation + (pointerAngle(e, rloc.element.bounds) - drag.start);
      // Shift steps in 15°, matching the inspector's own step
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(deg * 10) / 10;
      // normalise so the inspector never shows 720°
      deg = ((deg % 360) + 360) % 360;
      store.dispatch(P.composite([P.patchElement(drag.id, { rotation: deg })], drag.gkey));
      return;
    }
    var dx = (e.clientX - drag.sx) / zoom;
    var dy = (e.clientY - drag.sy) / zoom;
    if (drag.mode === 'resize') {
      var edges = snapEdges(t, [drag.id]);
      // not `moves` — the move branch below already owns that name, and `var`
      // is function-scoped
      var pulls = RESIZE_EDGES[drag.dir] || RESIZE_EDGES.se;
      var b = drag.b;
      // Each grip drags only the edges it sits on; the opposite edges stay put,
      // which is what makes a top/left handle grow the box upward/leftward
      // instead of moving it.
      var left = b.x;
      var top = b.y;
      var right = b.x + b.width;
      var bottom = b.y + b.height;
      var gx = null;
      var gy = null;
      if (pulls.left) {
        var sl = snapValue(b.x + dx, edges.xs, e.altKey);
        left = Math.min(sl.v, right - MIN_SIZE);
        gx = sl.guide;
      }
      if (pulls.right) {
        var sr = snapValue(right + dx, edges.xs, e.altKey);
        right = Math.max(sr.v, left + MIN_SIZE);
        gx = sr.guide;
      }
      if (pulls.top) {
        var st = snapValue(b.y + dy, edges.ys, e.altKey);
        top = Math.min(st.v, bottom - MIN_SIZE);
        gy = st.guide;
      }
      if (pulls.bottom) {
        var sb = snapValue(bottom + dy, edges.ys, e.altKey);
        bottom = Math.max(sb.v, top + MIN_SIZE);
        gy = sb.guide;
      }
      var w = right - left;
      var h = bottom - top;
      // Shift keeps the original proportions. The dominant axis wins so the box
      // follows the pointer rather than fighting it, and an edge handle (which
      // only drives one axis) derives the other.
      if (e.shiftKey && b.width > 0 && b.height > 0) {
        var ratio = b.width / b.height;
        var drivesX = pulls.left || pulls.right;
        var drivesY = pulls.top || pulls.bottom;
        if (drivesX && drivesY) {
          if (w / ratio > h) h = w / ratio;
          else w = h * ratio;
        } else if (drivesX) h = w / ratio;
        else if (drivesY) w = h * ratio;
        // re-anchor to whichever edges are NOT being dragged
        if (pulls.left) left = right - w;
        if (pulls.top) top = bottom - h;
      }
      showGuides(t, gx, gy);
      store.dispatch(
        P.setElementBounds(
          drag.id,
          {
            x: left,
            y: top,
            width: Math.max(MIN_SIZE, w),
            height: Math.max(MIN_SIZE, h),
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
    // a group opens instead of editing text — that is how you reach its children
    if (el.type === 'container') return enterGroup(el.id);
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
    // A dropped PDF runs the Format Cloner — the whole point of F2 is that you
    // should be able to throw a document at the canvas and get it back editable.
    // A dropped picture becomes an embedded image element (1.3).
    var dropped = e.dataTransfer.files && e.dataTransfer.files[0];
    if (dropped) {
      if (/\.pdf$/i.test(dropped.name) || dropped.type === 'application/pdf') cloneFromPdf(dropped);
      else if (IMAGE_TYPES[dropped.type]) {
        var rect = pageEl.getBoundingClientRect();
        var m = store.getState().page.margins;
        importImageFile(dropped, {
          x: Math.max(0, Math.round((e.clientX - rect.left) / zoom - m.left)),
          y: Math.max(0, Math.round((e.clientY - rect.top) / zoom - m.top)),
        });
      } else toast('فقط PDF یا تصویرِ PNG/JPEG را می‌شود اینجا انداخت', true);
      return;
    }
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
      P.addElement(curBandId(), {
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
  // empty-state quick actions (design-review 3.10) — delegated so it survives re-render
  inspectorEl.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-empty-action]') : null;
    if (!b) return;
    if (b.dataset.emptyAction === 'add-text') addElement('staticText');
    else if (b.dataset.emptyAction === 'gallery') document.getElementById('openGallery').click();
  });
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
      '<input type="number" step="any" min="0" data-band-height title="ارتفاع باند (' +
        unitLabel(t) +
        ')" value="' +
        (h === '' ? '' : toDisplay(h, t)) +
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
      'از جعبه‌ابزار روی این باند بکش، یا روی بوم کلیک کن.' +
      '<span class="empty-cta">' +
      '<button type="button" data-empty-action="add-text">+ افزودن متن</button>' +
      '<button type="button" data-empty-action="gallery">شروع از قالب</button>' +
      '</span></p>';
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
    store.dispatch(P.composite([P.ensureDataset(ds.name), P.addBand(newBand, idx)]));
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
          store.dispatch(P.composite([P.ensureDataset(ds.name), patchBandAt(i, patch)]));
        } else {
          store.dispatch(patchBandAt(i, patch));
        }
        renderCanvas();
        renderInspector();
      });
    var hInp = inspectorEl.querySelector('[data-band-height]');
    if (hInp)
      hInp.addEventListener('change', function () {
        store.dispatch(
          patchBandAt(i, {
            height: { mode: 'fixed', value: Math.max(8, fromDisplay(hInp.value) || 8) },
          }),
        );
      });
    var masterSel = inspectorEl.querySelector('[data-band-master]');
    if (masterSel)
      masterSel.addEventListener('change', function () {
        store.dispatch(patchBandAt(i, { master: masterSel.value }));
      });
    var dsInp = inspectorEl.querySelector('[data-band-dataset]');
    if (dsInp)
      dsInp.addEventListener('change', function () {
        var v = dsInp.value.trim();
        store.dispatch(P.composite([P.ensureDataset(v), patchBandAt(i, { dataset: v })]));
        renderCanvas();
        renderInspector();
      });
    var up = inspectorEl.querySelector('[data-band-up]');
    if (up)
      up.addEventListener('click', function () {
        if (i <= 0) return;
        store.dispatch(P.moveBand(i, i - 1));
        setActiveBand(i - 1);
      });
    var down = inspectorEl.querySelector('[data-band-down]');
    if (down)
      down.addEventListener('click', function () {
        if (i >= store.getState().bands.length - 1) return;
        store.dispatch(P.moveBand(i, i + 1));
        setActiveBand(i + 1);
      });
    var del = inspectorEl.querySelector('[data-band-del]');
    if (del)
      del.addEventListener('click', function () {
        var st = store.getState();
        if (st.bands.length <= 1) return;
        store.dispatch(P.removeBandById(getActiveBand(st).id));
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
    html +=
      '<div class="sec"><div class="sec-title">قرارگیری و اندازه ' +
      '<small class="hint">· ' +
      unitLabel(t) +
      '</small></div>';
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
    // the box you drew vs. what the engine paints (0.4) — offer the fit here,
    // next to the height field it corrects
    if (TEXT_AUTOGROW[el.type]) {
      var paintedH = paintedHeightOf(t, el.id);
      if (paintedH > b.height + 0.5) {
        html +=
          '<p class="warn-row">' +
          WARN_ICON +
          '<span>متن از جعبه بیرون زده — روی کاغذ ' +
          Math.round(paintedH) +
          'pt جا می‌گیرد، نه ' +
          Math.round(b.height) +
          'pt.</span>' +
          '<button type="button" data-fit-h="' +
          Math.ceil(paintedH) +
          '" title="قدِ جعبه را با متن جور کن">جا کن</button></p>';
      }
    }
    html +=
      '<div class="btnrow">' +
      '<button data-z="front" title="نمایش روی الِمان‌های دیگر">⬆ بیار جلو</button>' +
      '<button data-z="back" title="نمایش زیر الِمان‌های دیگر">⬇ بفرست عقب</button>' +
      '</div>';
    // one step at a time, relative to the siblings in this band/group
    html +=
      '<div class="btnrow">' +
      '<button data-zstep="forward" title="یک پله بالاتر از الِمانِ بعدی">↑ یک پله بالا</button>' +
      '<button data-zstep="backward" title="یک پله پایین‌تر از الِمانِ قبلی">↓ یک پله پایین</button>' +
      '</div>';
    html += '</div>';

    // --- editor affordances (§8A): name + lock -------------------------------
    html += '<div class="sec"><div class="sec-title">شناسه و قفل</div>';
    html += field(
      'نام',
      '<input data-prop="name" title="نامِ نمایشی در پنل لایه‌ها — روی خروجی اثری ندارد" ' +
        'placeholder="' +
        esc(layerLabel(el)) +
        '" value="' +
        esc(el.name || '') +
        '">',
    );
    html += field(
      'قفل',
      '<label class="chk"><input type="checkbox" data-prop="locked"' +
        (el.locked ? ' checked' : '') +
        '> جابه‌جایی، تغییر اندازه و حذف را قفل کن</label>',
    );
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
      html +=
        '<div class="btnrow">' +
        '<button data-group="1" title="این الِمان‌ها را یک گروه کن — با هم جابه‌جا می‌شوند (Ctrl+G)">' +
        'گروه‌بندی</button>' +
        '</div>';
      html += '</div>';
    }

    // --- group (a single selected container) ----------------------------------
    if (selectedContainer()) {
      html +=
        '<div class="sec"><div class="sec-title">گروه</div>' +
        '<p class="tinyhint">' +
        selectedContainer().children.length +
        ' الِمان داخل این گروه است؛ جابه‌جایی گروه همه را با خود می‌برد.</p>' +
        '<div class="btnrow">' +
        '<button data-ungroup="1" title="گروه را باز کن (Ctrl+Shift+G)">باز کردنِ گروه</button>' +
        '</div></div>';
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
      // Embedded bytes are the route that actually prints; a URL renders in the
      // preview but the PDF painter cannot fetch it (1.3).
      var res = el.resourceId
        ? (t.resources.images || []).filter(function (r) {
            return r.id === el.resourceId;
          })[0]
        : null;
      content +=
        '<div class="row"><label>فایل</label>' +
        '<button type="button" class="pickimg" data-pick-image>' +
        (res ? 'تعویضِ تصویر…' : 'انتخابِ تصویر…') +
        '</button></div>';
      if (res) {
        content +=
          '<p class="tinyhint">' +
          esc(el.name || res.id) +
          ' · جاسازی‌شده در قالب' +
          (res.width && res.height ? ' · ' + res.width + '×' + res.height + 'px' : '') +
          ' — بدونِ اینترنت هم چاپ می‌شود.' +
          ' <button type="button" class="linkbtn" data-clear-image>حذفِ تصویر</button></p>';
      } else {
        content +=
          '<p class="tinyhint">یا فایل را مستقیم روی بوم بینداز. ' +
          '<b>PNG و JPEG</b> در قالب جاسازی می‌شوند؛ آدرسِ اینترنتی فقط در پیش‌نمایش ' +
          'دیده می‌شود و در PDF جاسازی نمی‌شود.</p>';
      }
      content += field(
        'آدرس',
        '<input dir="ltr" title="جایگزینِ فایلِ جاسازی‌شده — در PDF جاسازی نمی‌شود" data-prop="imgsource" value="' +
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
    if (el.type === 'line') {
      looks += field(
        'رنگ خط',
        '<input type="color" data-prop="stroke" value="' +
          rgbToHex(el.stroke ? el.stroke.color : rgb(51, 65, 85)) +
          '">',
      );
    }
    if (
      el.type === 'staticText' ||
      el.type === 'dataField' ||
      el.type === 'richText' ||
      el.type === 'pageField'
    ) {
      looks += field(
        'فونت',
        '<select title="فونت‌های جاسازی‌شده در همین قالب — از تبِ لایه‌ها اضافه کن" data-prop="fontFamily">' +
          availableFamilies(t)
            .map(function (fam) {
              return (
                '<option value="' +
                esc(fam) +
                '"' +
                ((ty.fontFamily || BUNDLED_FAMILY) === fam ? ' selected' : '') +
                '>' +
                esc(fam) +
                '</option>'
              );
            })
            .join('') +
          '</select>',
      );
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
      // Style toggles share one row: three independent switches, each cheap.
      looks +=
        '<div class="row"><label>سبک</label><div class="tog-group">' +
        '<label class="tog" title="ضخیم"><input type="checkbox" data-prop="bold"' +
        (ty.fontWeight === 'bold' ? ' checked' : '') +
        '><b>ض</b></label>' +
        '<label class="tog" title="کج (ایتالیک)"><input type="checkbox" data-prop="italic"' +
        (ty.fontStyle === 'italic' ? ' checked' : '') +
        '><i>ک</i></label>' +
        '<label class="tog" title="زیرخط"><input type="checkbox" data-prop="underline"' +
        (ty.decoration === 'underline' ? ' checked' : '') +
        '><u>ز</u></label>' +
        '<label class="tog" title="خط‌خورده"><input type="checkbox" data-prop="strike"' +
        (ty.decoration === 'line-through' ? ' checked' : '') +
        '><s>خ</s></label>' +
        '</div></div>';
      looks += field(
        'تراز عمودی',
        '<select title="وقتی جعبه از متن بلندتر است، متن کجا بنشیند" data-prop="verticalAlign">' +
          '<option value="top"' +
          ((ty.verticalAlign || 'top') === 'top' ? ' selected' : '') +
          '>بالا</option>' +
          '<option value="middle"' +
          (ty.verticalAlign === 'middle' ? ' selected' : '') +
          '>وسط</option>' +
          '<option value="bottom"' +
          (ty.verticalAlign === 'bottom' ? ' selected' : '') +
          '>پایین</option>' +
          '</select>',
      );
      looks += field(
        'چینش',
        '<select title="تراز افقی متن. «دوطرفه» خطوط را با کشیدهٔ فارسی می‌کشد" data-prop="align">' +
          '<option value="start"' +
          ((ty.align || 'start') === 'start' ? ' selected' : '') +
          '>ابتدا</option>' +
          '<option value="center"' +
          (ty.align === 'center' ? ' selected' : '') +
          '>وسط</option>' +
          '<option value="end"' +
          (ty.align === 'end' ? ' selected' : '') +
          '>انتها</option>' +
          '<option value="justify"' +
          (ty.align === 'justify' ? ' selected' : '') +
          '>دوطرفه (کشیده)</option>' +
          '</select>',
      );
      if (ty.align === 'justify') {
        looks +=
          '<p class="tinyhint">تراز دوطرفه با درجِ کشیده (ـ) کار می‌کند، پس روی متنِ ' +
          '<b>فارسی/عربیِ چندخطی</b> دیده می‌شود؛ خطِ آخر و متنِ لاتین دست‌نخورده می‌مانند.</p>';
      }
      looks += field(
        'فاصلهٔ خطوط',
        '<input type="number" min="0.8" max="4" step="0.1" ' +
          'title="ضریبِ اندازهٔ فونت — ۱٫۲ پیش‌فرض. فقط روی متنِ چندخطی دیده می‌شود" ' +
          'data-prop="lineHeight" value="' +
          (ty.lineHeight == null ? '' : ty.lineHeight) +
          '" placeholder="1.2">',
      );
    }
    if (looks) {
      var looksTitle =
        selected.length > 1
          ? 'ظاهر <small class="hint">· روی هر ' + selected.length + ' الِمان</small>'
          : 'ظاهر';
      html += '<div class="sec"><div class="sec-title">' + looksTitle + '</div>' + looks + '</div>';
    }

    // --- box & border (designer-ux 1.2) --------------------------------------
    // `box` lives on every element, so this replaces the per-type fill controls
    // that used to be scattered through "ظاهر" (and that text, image, barcode,
    // chart and table never had at all). `line` is excluded: it paints from
    // `stroke`, so box controls there would be decoration.
    if (el.type !== 'line') {
      html += '<div class="sec"><div class="sec-title">جعبه و کادر</div>' + boxHtml(el) + '</div>';
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
  // --- display units (designer-ux 1.6) --------------------------------------
  // The model stores points, always — `page.unit` is documented as a display
  // convenience and the engine ignores it. So this converts on the way in and
  // out of the number fields and nothing else.
  //
  // Deliberately NOT converted: font size, border width and corner radius. Those
  // are typographic measures that every design tool keeps in points whatever the
  // ruler says, and mixing them into a millimetre document would read as a bug.
  var UNITS = {
    pt: { perPt: 1, decimals: 0, label: 'pt' },
    mm: { perPt: 25.4 / 72, decimals: 1, label: 'mm' },
    cm: { perPt: 2.54 / 72, decimals: 2, label: 'cm' },
  };
  function unitOf(t) {
    return UNITS[(t && t.page && t.page.unit) || 'pt'] || UNITS.pt;
  }
  /** Points → the document's display unit, rounded for a number input. */
  function toDisplay(pt, t) {
    var u = unitOf(t || store.getState());
    var v = pt * u.perPt;
    var f = Math.pow(10, u.decimals);
    return Math.round(v * f) / f;
  }
  /** A number typed in the display unit → points. */
  function fromDisplay(value, t) {
    var u = unitOf(t || store.getState());
    return Number(value) / u.perPt;
  }
  function unitLabel(t) {
    return unitOf(t || store.getState()).label;
  }

  var BOX_SIDES = [
    ['top', '↑', 'بالا'],
    ['right', '→', 'راست'],
    ['bottom', '↓', 'پایین'],
    ['left', '←', 'چپ'],
  ];
  /**
   * Read the border facts back out of the model. A `BorderSet` is either one
   * `all` side or a mix of named sides, so the panel shows a single
   * colour/width/style plus which edges are on — and `all` reads as all four.
   */
  function borderFacts(el) {
    var bx = el.box || {};
    var bd = bx.border || {};
    var ref = bd.all || bd.top || bd.right || bd.bottom || bd.left || null;
    // Width is the on/off switch; the side toggles only choose which edges a
    // border covers. With no border yet they default to all four, so typing a
    // width alone produces the box the user expects — otherwise the width would
    // have nowhere to live and would snap back to 0 on the next render.
    var on = {};
    BOX_SIDES.forEach(function (s) {
      on[s[0]] = ref ? (bd.all ? true : !!bd[s[0]]) : true;
    });
    return {
      hasFill: !!bx.fill,
      fill: bx.fill ? rgbToHex(bx.fill.color) : '#f1f5f9',
      color: ref ? rgbToHex(ref.color) : '#cbd5e1',
      width: ref ? ref.width : 0,
      style: (ref && ref.style) || 'solid',
      on: on,
      radius: bd.radius == null ? '' : bd.radius,
      opacityPct: Math.round((bx.opacity == null ? 1 : bx.opacity) * 100),
    };
  }
  function boxHtml(el) {
    var f = borderFacts(el);
    var s = '';
    s += field(
      'پُری',
      '<label class="chk"><input type="checkbox" data-prop="boxFillOn"' +
        (f.hasFill ? ' checked' : '') +
        '> دارد</label>' +
        '<input type="color" title="رنگ پُری" data-prop="boxFill" value="' +
        f.fill +
        '">',
    );
    s += field(
      'رنگ کادر',
      '<input type="color" data-prop="boxBorderColor" value="' + f.color + '">',
    );
    s += field(
      'ضخامت',
      '<input type="number" min="0" step="0.5" title="ضخامتِ کادر (pt) — صفر یعنی بدون کادر" ' +
        'data-prop="boxBorderWidth" value="' +
        f.width +
        '">',
    );
    s += field(
      'سبک کادر',
      '<select data-prop="boxBorderStyle">' +
        '<option value="solid"' +
        (f.style === 'solid' ? ' selected' : '') +
        '>توپر</option>' +
        '<option value="dashed"' +
        (f.style === 'dashed' ? ' selected' : '') +
        '>خط‌چین</option>' +
        '<option value="dotted"' +
        (f.style === 'dotted' ? ' selected' : '') +
        '>نقطه‌چین</option>' +
        '</select>',
    );
    s +=
      '<div class="row"><label>اضلاع</label><div class="tog-group">' +
      BOX_SIDES.map(function (sd) {
        return (
          '<label class="tog" title="' +
          sd[2] +
          '"><input type="checkbox" data-prop="boxSide-' +
          sd[0] +
          '"' +
          (f.on[sd[0]] ? ' checked' : '') +
          '>' +
          sd[1] +
          '</label>'
        );
      }).join('') +
      '</div></div>';
    s += field(
      'گردی گوشه',
      '<input type="number" min="0" step="1" title="شعاعِ گوشه (pt) — بیشتر از نصفِ ضلعِ کوتاه‌تر خودکار محدود می‌شود" ' +
        'data-prop="boxRadius" value="' +
        f.radius +
        '" placeholder="0">',
    );
    s += field(
      'شفافیت',
      '<input type="number" min="0" max="100" step="5" title="۱۰۰ یعنی کاملاً مات" ' +
        'data-prop="boxOpacity" value="' +
        f.opacityPct +
        '">',
    );
    return s;
  }

  var BOUND_TIPS = {
    x: 'فاصلهٔ افقی از لبهٔ ناحیهٔ محتوا',
    y: 'فاصلهٔ عمودی از بالای ناحیهٔ محتوا',
    w: 'پهنای الِمان',
    h: 'بلندی الِمان',
  };
  function numField(k, v) {
    return (
      '<div class="row"><label>' +
      k +
      '</label><input type="number" step="any" title="' +
      (BOUND_TIPS[k] || '') +
      '" data-bound="' +
      k +
      '" value="' +
      toDisplay(v) +
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
          v = fromDisplay(inp.value);
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
    // pick a picture for the selected image element (1.3)
    var pickBtn = inspectorEl.querySelector('[data-pick-image]');
    if (pickBtn)
      pickBtn.addEventListener('click', function () {
        pickImageFor(el.id);
      });
    var clearBtn = inspectorEl.querySelector('[data-clear-image]');
    if (clearBtn)
      clearBtn.addEventListener('click', function () {
        // drop the reference, then sweep the bytes it was the last user of
        store.dispatch(
          P.composite([P.patchElement(el.id, { resourceId: undefined }), P.pruneImageResources()]),
        );
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
            P.ensureDataset(v),
            P.modifyElement(
              id,
              pure(function (e) {
                e.dataset = v;
                return e;
              }),
            ),
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
      'fontFamily',
      function (e, v) {
        e.typography = Object.assign({}, e.typography, { fontFamily: v });
      },
      true,
    );
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
    // `fill` moved into the box panel below, which owns the whole `box` shape
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
    /**
     * Box & border (1.2). Every control rebuilds the whole `box` from the panel,
     * because a `BorderSet` is one shape — you cannot edit "the width" without
     * knowing which sides are on. Keys the panel does not manage (notably
     * `padding`, which no painter reads yet) are carried through untouched
     * rather than dropped from an imported template.
     */
    function applyBox() {
      var q = function (p) {
        return inspectorEl.querySelector('[data-prop="' + p + '"]');
      };
      var num = function (p) {
        var i = q(p);
        return i && i.value.trim() !== '' ? Number(i.value) : NaN;
      };
      var hasFill = q('boxFillOn') ? q('boxFillOn').checked : false;
      var fillHex = q('boxFill') ? q('boxFill').value : '#ffffff';
      var colorHex = q('boxBorderColor') ? q('boxBorderColor').value : '#cbd5e1';
      var width = num('boxBorderWidth');
      var styleSel = q('boxBorderStyle');
      var lineStyle = styleSel ? styleSel.value : 'solid';
      var sides = BOX_SIDES.map(function (s) {
        return s[0];
      }).filter(function (name) {
        var i = q('boxSide-' + name);
        return i && i.checked;
      });
      var radius = num('boxRadius');
      var opacity = num('boxOpacity');

      updateSelected(function (e) {
        var box = Object.assign({}, e.box);
        if (hasFill) box.fill = { color: hexToRgb(fillHex) };
        else delete box.fill;

        var border = {};
        if (width > 0 && sides.length) {
          var side = { width: width, color: hexToRgb(colorHex) };
          if (lineStyle !== 'solid') side.style = lineStyle;
          // all four edges collapse to `all` — the only form that can be drawn
          // as a single stroked rectangle, and the only one radius applies to
          if (sides.length === BOX_SIDES.length) border.all = side;
          else
            sides.forEach(function (name) {
              border[name] = side;
            });
        }
        if (radius > 0) border.radius = radius;
        if (Object.keys(border).length) box.border = border;
        else delete box.border;

        if (Number.isFinite(opacity) && opacity < 100) {
          box.opacity = Math.max(0, Math.min(100, opacity)) / 100;
        } else delete box.opacity;

        if (!Object.keys(box).length) delete e.box;
        else e.box = box;
        return e;
      });
    }
    BOX_SIDES.map(function (s) {
      return 'boxSide-' + s[0];
    })
      .concat([
        'boxFillOn',
        'boxFill',
        'boxBorderColor',
        'boxBorderWidth',
        'boxBorderStyle',
        'boxRadius',
        'boxOpacity',
      ])
      .forEach(function (prop) {
        var inp = inspectorEl.querySelector('[data-prop="' + prop + '"]');
        if (inp) inp.addEventListener('change', applyBox);
      });
    bindProp(
      'lineHeight',
      function (e, v) {
        var n = Number(v);
        var t = Object.assign({}, e.typography);
        // blank means "inherit the engine default" — store nothing rather than 0
        if (v.trim() === '' || !Number.isFinite(n) || n <= 0) delete t.lineHeight;
        else t.lineHeight = n;
        e.typography = t;
      },
      true,
    );
    /**
     * Checkbox typography toggles. `bindProp` reads `.value`, which is the string
     * "on" for a checkbox, so these need their own wiring. All three fan out to
     * the whole selection like the other appearance controls.
     */
    function bindToggle(prop, mut) {
      var inp = inspectorEl.querySelector('[data-prop="' + prop + '"]');
      if (!inp) return;
      inp.addEventListener('change', function () {
        updateSelected(function (e) {
          e.typography = Object.assign({}, e.typography, mut(inp.checked));
          return e;
        });
      });
    }
    bindToggle('bold', function (on) {
      return { fontWeight: on ? 'bold' : 'normal' };
    });
    bindToggle('italic', function (on) {
      return { fontStyle: on ? 'italic' : 'normal' };
    });
    // `decoration` holds one value, so the two switches are mutually exclusive:
    // turning one on clears the other rather than silently losing the write
    bindToggle('underline', function (on) {
      return { decoration: on ? 'underline' : 'none' };
    });
    bindToggle('strike', function (on) {
      return { decoration: on ? 'line-through' : 'none' };
    });
    bindProp(
      'verticalAlign',
      function (e, v) {
        e.typography = Object.assign({}, e.typography, { verticalAlign: v });
      },
      true,
    );
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
    inspectorEl.querySelectorAll('[data-zstep]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmds = selected.map(function (sid) {
          return P.moveElementZ(sid, btn.dataset.zstep);
        });
        if (cmds.length) store.dispatch(P.composite(cmds));
      });
    });
    // grow the box to the height the engine actually paints the text at (0.4)
    var fitBtn = inspectorEl.querySelector('[data-fit-h]');
    if (fitBtn)
      fitBtn.addEventListener('click', function () {
        var loc = P.findElement(store.getState(), el.id);
        if (!loc) return;
        var cur = loc.element.bounds;
        store.dispatch(
          P.setElementBounds(el.id, {
            x: cur.x,
            y: cur.y,
            width: cur.width,
            height: Number(fitBtn.dataset.fitH),
          }),
        );
      });
    var nameInp = inspectorEl.querySelector('[data-prop="name"]');
    if (nameInp)
      nameInp.addEventListener('change', function () {
        var v = nameInp.value.trim();
        // clearing the field drops back to the auto-generated label
        store.dispatch(P.renameElement(lastSelected(), v || undefined));
      });
    var lockInp = inspectorEl.querySelector('[data-prop="locked"]');
    if (lockInp)
      lockInp.addEventListener('change', function () {
        var cmds = selected.map(function (sid) {
          return P.setElementLocked(sid, lockInp.checked);
        });
        if (cmds.length) store.dispatch(P.composite(cmds));
      });
    var grpBtn = inspectorEl.querySelector('[data-group]');
    if (grpBtn) grpBtn.addEventListener('click', groupSelected);
    var ungrpBtn = inspectorEl.querySelector('[data-ungroup]');
    if (ungrpBtn) ungrpBtn.addEventListener('click', ungroupSelected);
    var dup = document.getElementById('dupEl');
    if (dup) dup.addEventListener('click', duplicateSelected);
    var del = document.getElementById('deleteEl');
    if (del) del.addEventListener('click', deleteSelected);
    function bindProp(prop, mut, bulk) {
      var inp = inspectorEl.querySelector('[data-prop="' + prop + '"]');
      // checkboxes report `.value === 'on'` regardless of state; they go through
      // `bindToggle` instead, so `bindProp` is never called with one
      if (!inp) return;
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
    var w = Math.max(40, fromDisplay(document.getElementById('pageW').value) || 0);
    var hgt = Math.max(40, fromDisplay(document.getElementById('pageH').value) || 0);
    store.dispatch(P.patchPageSetup({ size: { width: w, height: hgt } }));
  }
  document.getElementById('pageW').addEventListener('change', dispatchCustomSize);
  document.getElementById('pageH').addEventListener('change', dispatchCustomSize);
  document.getElementById('pageOrient').addEventListener('change', function (e) {
    store.dispatch(P.patchPageSetup({ orientation: e.target.value }));
  });
  // display unit (1.6) — stored on the page so it travels with the template,
  // but it changes nothing about the output, only what the number fields say
  document.getElementById('pageUnit').addEventListener('change', function (e) {
    store.dispatch(P.patchPageSetup({ unit: e.target.value }));
  });
  // locale (1.7) — digits and calendar both measurably change the output
  document.getElementById('pageDigits').addEventListener('change', function (e) {
    var loc = store.getState().page.locale;
    store.dispatch(
      P.patchPageSetup({ locale: Object.assign({}, loc, { digits: e.target.value }) }),
    );
  });
  document.getElementById('pageCalendar').addEventListener('change', function (e) {
    var loc = store.getState().page.locale;
    store.dispatch(
      P.patchPageSetup({ locale: Object.assign({}, loc, { calendar: e.target.value }) }),
    );
  });
  // margins (1.5)
  var MARGIN_INPUTS = {
    top: document.getElementById('mgTop'),
    right: document.getElementById('mgRight'),
    bottom: document.getElementById('mgBottom'),
    left: document.getElementById('mgLeft'),
  };
  var marginLinkEl = document.getElementById('mgLink');
  function applyMargins(changedSide) {
    var t = store.getState();
    var next = {};
    if (marginLinkEl.checked && changedSide) {
      var all = Math.max(0, fromDisplay(MARGIN_INPUTS[changedSide].value, t) || 0);
      next = { top: all, right: all, bottom: all, left: all };
    } else {
      Object.keys(MARGIN_INPUTS).forEach(function (side) {
        next[side] = Math.max(0, fromDisplay(MARGIN_INPUTS[side].value, t) || 0);
      });
    }
    store.dispatch(P.patchPageSetup({ margins: next }));
  }
  Object.keys(MARGIN_INPUTS).forEach(function (side) {
    MARGIN_INPUTS[side].addEventListener('change', function () {
      applyMargins(side);
    });
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
        showLocalDiag('error', 'JSON نامعتبر:\n' + detail);
        // surface it wherever the user is — not just on the hidden data tab
        toast('واردکردن ناموفق — JSON نامعتبر:\n' + detail.split('\n')[0], true);
        return;
      }
      loadTemplate(res.value);
    };
    reader.readAsText(file);
  });

  // --- Format Cloner (F2.5): drop a PDF → bound template ----------------------
  var cloneReviewEl = document.getElementById('cloneReview');
  function showCloneReview(result) {
    var data = result.inferredData || {};
    var fields = (result.schema && result.schema.fields) || [];
    var tables = (result.schema && result.schema.tables) || [];
    function esc(s) {
      return String(s).replace(/[&<>]/g, function (c) {
        return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
      });
    }
    var chip =
      'display:inline-flex;gap:6px;align-items:baseline;margin:0 0 6px 6px;padding:4px 9px;' +
      'border:1px solid var(--border);border-radius:var(--r-pill);background:var(--field);font-size:var(--fs-xs)';
    var mono =
      'font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--accent);direction:ltr';
    var parts = [];
    parts.push(
      '<div><div class="sec-title">فیلدها <span class="hint">' +
        fields.length +
        '</span></div>' +
        (fields.length
          ? fields
              .map(function (f) {
                var val = data[f.path];
                return (
                  '<span style="' +
                  chip +
                  '"><b style="' +
                  mono +
                  '">' +
                  esc(f.path) +
                  '</b>' +
                  (f.kind ? '<span style="color:var(--faint)">' + esc(f.kind) + '</span>' : '') +
                  (val != null
                    ? '<span style="color:var(--muted)">= ' + esc(val) + '</span>'
                    : '') +
                  '</span>'
                );
              })
              .join('')
          : '<p class="tinyhint">فیلدی تشخیص داده نشد.</p>') +
        '</div>',
    );
    parts.push(
      '<div><div class="sec-title">جدول‌ها <span class="hint">' +
        tables.length +
        '</span></div>' +
        (tables.length
          ? tables
              .map(function (t) {
                var rows = Array.isArray(data[t.path]) ? data[t.path].length : 0;
                return (
                  '<span style="' +
                  chip +
                  '"><b style="' +
                  mono +
                  '">' +
                  esc(t.path) +
                  '</b><span style="color:var(--muted)">' +
                  esc(t.columns.join(' · ')) +
                  ' · ' +
                  rows +
                  ' ردیف</span></span>'
                );
              })
              .join('')
          : '<p class="tinyhint">جدولی تشخیص داده نشد.</p>') +
        '</div>',
    );
    if (result.warnings && result.warnings.length) {
      parts.push(
        '<p class="tinyhint">' +
          esc(result.warnings.length) +
          ' هشدار هنگام استخراج (منحنی/تصویر/نشانه‌های ریز نادیده گرفته شدند).</p>',
      );
    }
    document.getElementById('cloneReviewBody').innerHTML = parts.join('');
    cloneReviewEl.classList.add('show');
  }
  function closeCloneReview() {
    cloneReviewEl.classList.remove('show');
  }
  document.getElementById('closeCloneReview').addEventListener('click', closeCloneReview);
  document.getElementById('cloneKeepEditing').addEventListener('click', closeCloneReview);
  cloneReviewEl.addEventListener('click', function (e) {
    if (e.target === cloneReviewEl) closeCloneReview();
  });
  /**
   * Closes the loop the three moonshot pieces were built for but never joined:
   * the cloned document goes straight out as a tamper-evident PDF. Drives the
   * existing toggle and download button rather than duplicating either, so the
   * printed code stays the one the panel and verify.html agree on (F1.5).
   */
  document.getElementById('cloneStampDownload').addEventListener('click', function () {
    closeCloneReview();
    var chk = document.getElementById('verifyStamp');
    if (!chk.checked) {
      chk.checked = true;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.getElementById('downloadPdf').click();
  });

  document.getElementById('cloneFormat').addEventListener('click', function () {
    if (!window.pdfjsLib) {
      toast('pdfjs بارگذاری نشد — اول `npm run designer:build` را اجرا کن', true);
      return;
    }
    document.getElementById('pdfInput').click();
  });
  var cloneBusy = false;
  /**
   * The whole Format Cloner pipeline for one PDF: extract → classify → infer →
   * bind → load. Shared by the file menu and by dropping a PDF on the canvas,
   * so the two entry points cannot drift.
   */
  /**
   * Only the two raster formats both painters embed (measured, 1.3). SVG is in
   * the model's `ImageMime` and the SVG painter shows it, but the PDF painter
   * cannot embed it ("The input is not a PNG file!"), so it is refused at the
   * door with a reason rather than accepted and quietly dropped from the print.
   */
  var IMAGE_TYPES = { 'image/png': true, 'image/jpeg': true };
  var MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  var MAX_FONT_BYTES = 6 * 1024 * 1024;
  /** The family the bundled Vazirmatn registers under; always offered. */
  var BUNDLED_FAMILY = 'Vazirmatn';

  /** Families the document can use: the bundled one plus whatever it carries. */
  function availableFamilies(t) {
    var out = [BUNDLED_FAMILY];
    (t.resources.fonts || []).forEach(function (f) {
      if (out.indexOf(f.family) === -1) out.push(f.family);
    });
    return out;
  }

  /**
   * Mirror the template's fonts into the page as `@font-face` rules.
   *
   * The canvas is the engine's own SVG, which names families and leaves the
   * browser to find them — so without this an uploaded font would print
   * correctly and preview as a fallback face, which is exactly the WYSIWYG
   * divergence this designer exists to avoid.
   */
  var fontFaceEl = null;
  var fontFaceKey = '';
  function syncFontFaces(t) {
    var fonts = (t.resources.fonts || []).filter(function (f) {
      return f.data;
    });
    var key = fonts
      .map(function (f) {
        return f.id + ':' + f.family + ':' + f.data.length;
      })
      .join('|');
    if (key === fontFaceKey) return; // re-rendering does not re-parse the bytes
    fontFaceKey = key;
    if (!fontFaceEl) {
      fontFaceEl = document.createElement('style');
      fontFaceEl.id = 'templateFontFaces';
      document.head.appendChild(fontFaceEl);
    }
    fontFaceEl.textContent = fonts
      .map(function (f) {
        return (
          "@font-face{font-family:'" +
          String(f.family).replace(/['\\]/g, '') +
          "';font-weight:" +
          (f.weight === 'bold' ? 'bold' : 'normal') +
          ';font-style:' +
          (f.style === 'italic' ? 'italic' : 'normal') +
          ';src:url(data:font/ttf;base64,' +
          f.data +
          ');}'
        );
      })
      .join('\n');
  }

  /**
   * Read a picture into the template as an embedded resource and place an
   * element referencing it — one undoable step. The bytes live in
   * `resources.images` so the template stays self-contained and prints without
   * a network round trip (a URL image is not embedded in the PDF at all).
   */
  function readImageResource(file, done) {
    if (!IMAGE_TYPES[file.type]) {
      toast('فقط PNG و JPEG پشتیبانی می‌شوند — SVG در PDF جاسازی نمی‌شود', true);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast('تصویر بزرگ‌تر از ۴ مگابایت است؛ اول فشرده‌اش کن', true);
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      toast('خواندن تصویر ناموفق بود', true);
    };
    reader.onload = function () {
      var dataUri = String(reader.result || '');
      var comma = dataUri.indexOf(',');
      if (comma < 0) return toast('تصویر خوانده نشد', true);
      var resource = { id: 'img-' + uid++, mime: file.type, data: dataUri.slice(comma + 1) };
      // Measure it so the element can land at the picture's own aspect ratio.
      // The intrinsic size is a nicety, not a requirement, so the import must
      // not hang on it: an environment without an image decoder (jsdom) fires
      // neither event, and a corrupt file can stall a real decoder too.
      var probe = new window.Image();
      var settled = false;
      var finish = function (w, h) {
        if (settled) return;
        settled = true;
        if (w > 0 && h > 0) {
          resource.width = w;
          resource.height = h;
        }
        done(resource, w, h);
      };
      setTimeout(function () {
        finish(0, 0);
      }, 250);
      probe.onerror = function () {
        finish(0, 0);
      };
      probe.onload = function () {
        finish(probe.naturalWidth, probe.naturalHeight);
      };
      probe.src = dataUri;
    };
    reader.readAsDataURL(file);
  }
  function importImageFile(file, at) {
    readImageResource(file, function (resource, natW, natH) {
      var elId = 'el-' + uid++;
      selected = [elId];
      store.dispatch(
        P.composite([
          P.ensureImageResource(resource),
          P.addElement(curBandId(), {
            id: elId,
            type: 'image',
            bounds: imageBox(natW, natH, at),
            zIndex: 1,
            resourceId: resource.id,
            fit: 'contain',
            name: file.name,
          }),
        ]),
      );
      setTab('design');
      toast('تصویر جاسازی شد', { type: 'success' });
    });
  }
  /** Fit a picture into a sensible default box, preserving its aspect ratio. */
  function imageBox(natW, natH, at) {
    var MAXW = 180;
    var w = MAXW;
    var h = natW > 0 && natH > 0 ? Math.round((natH / natW) * MAXW) : 120;
    if (h > 240) {
      h = 240;
      w = natH > 0 ? Math.round((natW / natH) * 240) : MAXW;
    }
    // A drop point is only usable if it actually arrived: a drag whose event
    // carries no coordinates yields NaN, and NaN bounds crash the PDF writer
    // several steps later with nothing pointing back here.
    var usable = at && Number.isFinite(at.x) && Number.isFinite(at.y);
    var spot = usable ? at : nextSpot(w, h);
    return { x: spot.x, y: spot.y, width: w, height: h };
  }
  /**
   * Open the picker and point the given element at whatever comes back. One
   * hidden input is reused, so the pending target is tracked here.
   */
  var imageInputEl = document.getElementById('imageInput');
  var pendingImageFor = null;
  function pickImageFor(elementId) {
    pendingImageFor = elementId || null;
    imageInputEl.value = '';
    imageInputEl.click();
  }
  imageInputEl.addEventListener('change', function () {
    var file = imageInputEl.files && imageInputEl.files[0];
    if (!file) return;
    var target = pendingImageFor;
    pendingImageFor = null;
    if (!target) return importImageFile(file, null);
    // replacing an existing element's picture: keep its box, swap the bytes,
    // and sweep whatever it used to point at — one undo step
    readImageResource(file, function (resource) {
      store.dispatch(
        P.composite([
          P.ensureImageResource(resource),
          P.patchElement(target, { resourceId: resource.id, source: undefined }),
          P.pruneImageResources(),
        ]),
      );
      toast('تصویر جاسازی شد', { type: 'success' });
    });
  });

  // --- font manager (designer-ux 1.4) ---------------------------------------
  var fontListEl = document.getElementById('fontList');
  var fontInputEl = document.getElementById('fontInput');

  function renderFontList() {
    var t = store.getState();
    var fonts = t.resources.fonts || [];
    if (!fonts.length) {
      fontListEl.innerHTML =
        '<p class="tinyhint">فقط <b>' + BUNDLED_FAMILY + '</b>ِ باندل‌شده در دسترس است.</p>';
      return;
    }
    fontListEl.innerHTML = '';
    fonts.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'st-row';
      var name = document.createElement('span');
      name.className = 'st-name';
      name.textContent = f.family + (f.weight === 'bold' ? ' · ضخیم' : '');
      // show each face in itself — the point of embedding it
      name.style.fontFamily = "'" + f.family + "'";
      if (f.weight === 'bold') name.style.fontWeight = 'bold';
      row.appendChild(name);
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'st-del';
      del.title = 'حذفِ فونت از قالب';
      del.textContent = '✕';
      del.addEventListener('click', function () {
        store.dispatch(P.removeFontResource(f.id));
        toast('فونت حذف شد', {
          type: 'success',
          action: {
            label: 'واگرد',
            onClick: function () {
              store.undo();
            },
          },
        });
      });
      row.appendChild(del);
      fontListEl.appendChild(row);
    });
  }

  document.getElementById('addFont').addEventListener('click', function () {
    fontInputEl.value = '';
    fontInputEl.click();
  });
  fontInputEl.addEventListener('change', function () {
    var file = fontInputEl.files && fontInputEl.files[0];
    if (file) importFontFile(file);
  });

  /**
   * Read a TTF/OTF into `resources.fonts`. The family name is taken from the
   * file name and confirmed by the author, because the real name lives inside
   * the font's `name` table and parsing that here would mean shipping a font
   * parser into the page for a string the author already knows.
   */
  function importFontFile(file) {
    if (!/\.(ttf|otf)$/i.test(file.name)) {
      toast('فقط TTF و OTF پشتیبانی می‌شوند', true);
      return;
    }
    if (file.size > MAX_FONT_BYTES) {
      toast('فونت بزرگ‌تر از ۶ مگابایت است', true);
      return;
    }
    var suggested = file.name.replace(/\.(ttf|otf)$/i, '').replace(/[-_]/g, ' ');
    var family = window.prompt('نامِ خانوادهٔ فونت (همین نام در «فونت» انتخاب می‌شود):', suggested);
    if (family === null) return;
    family = String(family).trim();
    if (!family) return toast('نامِ فونت خالی بود', true);
    var reader = new FileReader();
    reader.onerror = function () {
      toast('خواندن فونت ناموفق بود', true);
    };
    reader.onload = function () {
      var dataUri = String(reader.result || '');
      var comma = dataUri.indexOf(',');
      if (comma < 0) return toast('فونت خوانده نشد', true);
      var bold = /bold/i.test(file.name);
      store.dispatch(
        P.ensureFontResource({
          id: 'font-' + uid++,
          family: family,
          data: dataUri.slice(comma + 1),
          // a "…-Bold.ttf" is almost always the bold face; the author can still
          // upload it under its own family name if that guess is wrong
          ...(bold ? { weight: 'bold' } : {}),
        }),
      );
      toast('فونت «' + family + '» جاسازی شد', { type: 'success' });
    };
    reader.readAsDataURL(file);
  }

  async function cloneFromPdf(file) {
    if (!file || cloneBusy) return;
    if (!window.pdfjsLib) {
      toast('pdfjs بارگذاری نشد — اول `npm run designer:build` را اجرا کن', true);
      return;
    }
    cloneBusy = true;
    var btn = document.getElementById('cloneFormat');
    setLoading(btn, true);
    try {
      if (window.pdfjsLib.GlobalWorkerOptions) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';
      }
      var buf = await file.arrayBuffer();
      var doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      var name = file.name.replace(/\.pdf$/i, '') || 'Cloned format';
      var result = await P.cloneFormatDocument(doc, { name: name });
      // load the faithful sample data + the bound template (mirror gallery load)
      sampleData = result.inferredData || {};
      sampleEl.value = JSON.stringify(sampleData, null, 2);
      renderFieldPicker();
      loadTemplate(result.template);
      setTab('design');
      showCloneReview(result);
      toast(
        'کلون شد: ' +
          result.schema.fields.length +
          ' فیلد، ' +
          result.schema.tables.length +
          ' جدول',
        { type: 'success' },
      );
    } catch (err) {
      toast('کلونِ فرمت ناموفق: ' + (err && err.message ? err.message : String(err)), true);
    } finally {
      cloneBusy = false;
      setLoading(btn, false);
    }
  }
  document.getElementById('pdfInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = ''; // allow re-picking the same file later
    cloneFromPdf(file);
  });

  // async-button loading state (design-review 2.4): spinner + aria-busy + re-entry guard
  function setLoading(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-loading', on);
    if (on) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }

  // --- verifiable documents (F1.5) -------------------------------------------
  // A designer-local toggle (not part of the template) that stamps a tamper-
  // evident QR + short code onto the downloaded PDF. The hash must be
  // reproducible by verify.html, which recomputes it from template + data
  // alone — so the verified render deliberately omits the volatile `now`, and
  // the code shown live in the panel is exactly what lands on the paper.
  var VERIFY_KEY = 'pdfstudio.verify';
  var verifyOn = false;
  try {
    verifyOn = window.localStorage.getItem(VERIFY_KEY) === '1';
  } catch (e) {
    /* private mode: default off */
  }
  var verifyChk = document.getElementById('verifyStamp');
  var verifyCodeRow = document.getElementById('verifyCodeRow');
  var verifyCodeEl = document.getElementById('verifyCode');
  var verifyHintEl = document.getElementById('verifyHint');
  verifyChk.checked = verifyOn;
  /** The hashed render input for the verification stamp (no volatile clock). */
  function verifyInput() {
    return { data: sampleData };
  }
  /** Reflect the toggle: show/hide the live code and recompute it when on. */
  function updateVerifyUi() {
    var show = verifyOn ? '' : 'none';
    verifyCodeRow.style.display = show;
    verifyHintEl.style.display = show;
    if (!verifyOn) return;
    try {
      verifyCodeEl.textContent = P.hashDocument(store.getState(), verifyInput()).short;
    } catch (e) {
      verifyCodeEl.textContent = '—';
    }
  }
  verifyChk.addEventListener('change', function () {
    verifyOn = verifyChk.checked;
    try {
      window.localStorage.setItem(VERIFY_KEY, verifyOn ? '1' : '0');
    } catch (e) {
      /* ignore persistence failure */
    }
    updateVerifyUi();
  });

  var pdfBusy = false;
  document.getElementById('downloadPdf').addEventListener('click', async function () {
    if (pdfBusy) return;
    pdfBusy = true;
    setLoading(this, true);
    try {
      var fonts = window.VAZIRMATN_BASE64
        ? [{ family: 'Vazirmatn', bytes: base64ToBytes(window.VAZIRMATN_BASE64) }]
        : [];
      // With the verification stamp on, render from the reproducible input
      // (no volatile `now`) so the printed code matches verify.html; otherwise
      // pin `now` to the current clock so date/now fields render as today.
      var input = verifyOn ? verifyInput() : { data: sampleData, now: Date.now() };
      var opts = { pdf: { fonts: fonts } };
      if (verifyOn) opts.verify = true;
      var res = await P.renderToPdf(store.getState(), input, opts);
      var blob = new Blob([res.bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'document.pdf';
      a.click();
      URL.revokeObjectURL(url);
      // the export ran layout AND paint, so its diagnostics are a superset of
      // the live ones (font/image embedding only fails at paint time). Show
      // them until the next edit recomputes the live pass.
      liveDiags = res.diagnostics;
      renderDiagnostics();
      var verifyNote = '';
      if (verifyOn) {
        try {
          verifyNote = ' · کدِ تأیید ' + P.hashDocument(store.getState(), verifyInput()).short;
        } catch (e) {
          /* leave the code out if hashing fails */
        }
      }
      toast(
        (res.diagnostics.length
          ? 'PDF با ' + res.diagnostics.length + ' هشدار ساخته شد'
          : 'PDF ساخته شد و در حال دانلود است') + verifyNote,
        { type: res.diagnostics.length ? 'info' : 'success' },
      );
    } catch (err) {
      showLocalDiag('error', err.message);
      toast('ساخت PDF ناموفق: ' + err.message, true);
    } finally {
      pdfBusy = false;
      setLoading(document.getElementById('downloadPdf'), false);
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
      renderFieldPicker();
      renderCanvas();
      renderPreview();
      // the data drives every binding, so its diagnostics change with it (0.3)
      scheduleDiagnostics();
    } catch (err) {
      // invalid JSON means nothing can be evaluated — say that instead of
      // reporting stale diagnostics from the last parseable data
      showLocalDiag('error', 'دادهٔ JSON نامعتبر');
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
  // inline SVG icons keep the top bar consistent — no OS-dependent color emoji
  var ICON_SUN =
    '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.4v2M10 15.6v2M2.4 10h2M15.6 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"/></svg>';
  var ICON_MOON =
    '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.6 11.3A5.8 5.8 0 1 1 8.7 4.4a4.6 4.6 0 0 0 6.9 6.9Z"/></svg>';
  var ICON_HASH =
    '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7.6 3.5 6 16.5M14 3.5 12.4 16.5M4 7.5h11.5M3.5 12.5H15"/></svg>';
  var ICON_TAG =
    '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h5.4L16 11l-5.5 5.5L4 9.9Z"/><circle cx="7" cy="7.5" r="1"/></svg>';
  var THEME_KEY = 'pdfstudio.theme';
  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    document.getElementById('toggleTheme').innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
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

  function updateValuesBtn() {
    document.getElementById('toggleValues').innerHTML =
      (showValues ? ICON_HASH : ICON_TAG) +
      '<span>' +
      (showValues ? 'مقادیر' : 'نام فیلد') +
      '</span>';
  }
  document.getElementById('toggleValues').addEventListener('click', function () {
    showValues = !showValues;
    updateValuesBtn();
    renderCanvas();
  });
  updateValuesBtn();

  // --- command palette (Ctrl+K, §8A) -------------------------------------------
  var paletteEl = document.getElementById('palette');
  var paletteInput = document.getElementById('paletteInput');
  var paletteListEl = document.getElementById('paletteList');
  var paletteIndex = 0;
  /**
   * Toolbox entries, read off the rail instead of repeated here. The hand-kept
   * copy had drifted to 9 while the rail grew to 12, so **table**, labelled
   * field and page field were unreachable from Ctrl+K — the table being the one
   * element a report author reaches for first (designer-ux 1.9). Deriving them
   * means the two can no longer disagree.
   */
  function toolboxCommands() {
    return Array.prototype.map.call(
      document.querySelectorAll('.toolrail [data-add]'),
      function (btn) {
        var type = btn.dataset.add;
        return {
          // the rail already carries a Persian "افزودن …" label for screen readers
          label: btn.getAttribute('aria-label') || 'افزودن ' + faName(type),
          hint: 'toolbox',
          run: function () {
            addElement(type);
          },
        };
      },
    );
  }
  function paletteCommands() {
    var cmds = toolboxCommands().concat([
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
      { label: 'زوم 1:1', hint: 'زوم', run: () => setZoom(1) },
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
    ]);
    if (selected.length) {
      cmds.unshift(
        { label: 'کپی انتخاب (Ctrl+D)', hint: 'انتخاب', run: duplicateSelected },
        { label: 'حذف انتخاب', hint: 'انتخاب', run: deleteSelected },
        { label: 'بیار جلو', hint: 'انتخاب', run: () => reorderSelected(true) },
        { label: 'بفرست عقب', hint: 'انتخاب', run: () => reorderSelected(false) },
      );
      if (selected.length > 1) {
        cmds.unshift({ label: 'گروه‌بندی (Ctrl+G)', hint: 'انتخاب', run: groupSelected });
      }
      if (selectedContainer()) {
        cmds.unshift({
          label: 'باز کردنِ گروه (Ctrl+Shift+G)',
          hint: 'انتخاب',
          run: ungroupSelected,
        });
      }
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
    var deletable = unlockedSelection();
    if (deletable.length < selected.length) lockedNudge();
    var n = deletable.length;
    // one composite → deleting a whole selection is a single undo step
    var cmds = deletable.map(function (sid) {
      return P.removeElementById(sid);
    });
    if (cmds.length) store.dispatch(P.composite(cmds));
    // whatever survived (locked) stays selected, so the user can go unlock it
    selected = selected.filter(isLocked);
    if (n) {
      toast(n === 1 ? 'الِمان حذف شد' : n + ' الِمان حذف شد', {
        action: {
          label: 'واگرد',
          onClick: function () {
            store.undo();
          },
        },
      });
    }
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
        '<li><b>زوم</b>: <kbd>Ctrl</kbd>+چرخ موس؛ «1:1» اندازهٔ واقعی چاپ، «جا بده» کل صفحه.</li></ul>',
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
      body: '۲۲ طرح حرفه‌ای با پیش‌نمایش زنده، جست‌وجو، دسته‌بندی و شش پالت رنگی. بهترین نقطهٔ شروع.',
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
  // The gallery is a small search app: a category filter, a full-text box over
  // name/description/tags, and a palette picker that re-skins every template by
  // swapping its two brand tokens (see templates.js `themeTemplate`). Thumbnails
  // are real engine renders, scaled to *fit* their card so a portrait A4 and a
  // landscape ticket read as the same kind of object.
  var galleryEl = document.getElementById('gallery');
  var galleryCardsEl = document.getElementById('galleryCards');
  var tplSearchEl = document.getElementById('tplSearch');
  var tplCatsEl = document.getElementById('tplCats');
  var tplThemesEl = document.getElementById('tplThemes');
  var tplEmptyEl = document.getElementById('tplEmpty');
  var tplCountEl = document.getElementById('tplCount');
  var tplZoomEl = document.getElementById('tplZoom');
  var tplZoomStageEl = document.getElementById('tplZoomStage');
  var TPL_THEME_KEY = 'pdfstudio.tplTheme';
  var THUMB_INSET = 12; // breathing room between the paper and the card edge
  var THUMB_W = 172; // fallback box when there is no layout engine (jsdom)
  var THUMB_H = 184;

  var tplQuery = '';
  var tplCat = 'all';
  var tplTheme = 'indigo';
  try {
    tplTheme = window.localStorage.getItem(TPL_THEME_KEY) || 'indigo';
  } catch (e) {
    /* private mode: stay on the default palette */
  }
  var tplVisible = []; // the currently filtered entries, in card order
  var tplFocus = 0; // keyboard cursor into `tplVisible`
  var tplChromeReady = false;
  var thumbCache = {}; // 'templateId|themeId' → rendered SVG string
  var tplZoomEntry = null;

  function faDigits(n) {
    return String(n).replace(/[0-9]/g, function (d) {
      return '۰۱۲۳۴۵۶۷۸۹'.charAt(Number(d));
    });
  }
  /** Fold the Arabic/Persian letter variants and ZWNJ so search is forgiving. */
  function tplNorm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/‌/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function tplEntries() {
    return window.PDFSTUDIO_TEMPLATES || [];
  }
  function tplEntryById(id) {
    var found = null;
    tplEntries().forEach(function (e) {
      if (e.id === id) found = e;
    });
    return found;
  }
  /** A themed deep copy — the gallery never hands out a shared template object. */
  function tplThemed(template) {
    var fn = window.PDFSTUDIO_THEME_TEMPLATE;
    return fn ? fn(template, tplTheme) : JSON.parse(JSON.stringify(template));
  }
  /**
   * Badge the page format — but stay quiet for the plain A4 portrait everyone
   * already assumes, so the chip marks the exceptions instead of repeating
   * itself on almost every card. Custom sizes are reported the way the engine
   * will actually resolve them (short side first unless landscape).
   */
  function tplSizeLabel(template) {
    var pg = (template && template.page) || {};
    var landscape = pg.orientation === 'landscape';
    if (typeof pg.size === 'string')
      return pg.size === 'A4' && !landscape ? '' : pg.size + (landscape ? ' افقی' : ' عمودی');
    if (pg.size && pg.size.width) {
      var long = Math.round(Math.max(pg.size.width, pg.size.height));
      var short = Math.round(Math.min(pg.size.width, pg.size.height));
      return landscape
        ? faDigits(long) + '×' + faDigits(short) + ' pt'
        : faDigits(short) + '×' + faDigits(long) + ' pt';
    }
    return landscape ? 'افقی' : 'عمودی';
  }
  function tplThumb(entry) {
    var key = entry.id + '|' + tplTheme;
    if (thumbCache[key] === undefined) {
      var svg = '';
      try {
        // live WYSIWYG thumbnail: the engine renders page 1 of the template
        svg = P.renderToSvg(tplThemed(entry.template), { data: entry.data }).pages[0] || '';
      } catch (err) {
        svg = '';
      }
      thumbCache[key] = svg;
    }
    return thumbCache[key];
  }
  function tplMatches(entry, terms) {
    // `cat: 'all'` entries (the blank canvas) stay reachable from every filter
    if (tplCat !== 'all' && entry.cat !== 'all' && entry.cat !== tplCat) return false;
    if (!terms.length) return true;
    var hay = tplNorm([entry.name, entry.desc, entry.id].concat(entry.tags || []).join(' '));
    return terms.every(function (t) {
      return hay.indexOf(t) >= 0;
    });
  }

  /**
   * Scale the engine SVG so the whole page fits its card, never cropped. The box
   * is measured from the live card rather than assumed, so the fit stays right
   * at every grid width; jsdom (no layout) falls back to the nominal box.
   */
  function fitThumb(card) {
    var thumb = card.querySelector('.tpl-thumb');
    var svg = card.querySelector('.tpl-thumb svg');
    var paper = card.querySelector('.tpl-paper');
    if (!thumb || !svg || !paper) return;
    var boxW = (thumb.clientWidth || 0) - THUMB_INSET * 2;
    var boxH = (thumb.clientHeight || 0) - THUMB_INSET * 2;
    if (boxW <= 0 || boxH <= 0) {
      boxW = THUMB_W;
      boxH = THUMB_H;
    }
    var w = Number(svg.getAttribute('width')) || 595;
    var h = Number(svg.getAttribute('height')) || 842;
    var k = Math.min(boxW / w, boxH / h);
    paper.style.width = Math.round(w * k) + 'px';
    paper.style.height = Math.round(h * k) + 'px';
    svg.style.transform = 'scale(' + k + ')';
  }
  function fitAllThumbs() {
    Array.prototype.forEach.call(galleryCardsEl.querySelectorAll('.tpl-card'), fitThumb);
  }

  function tplChip(cls, textValue) {
    return textValue ? '<span class="' + cls + '">' + esc(textValue) + '</span>' : '';
  }
  function buildTplCard(entry, index) {
    var card = document.createElement('div');
    card.className = 'tpl-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.template = entry.id;
    card.dataset.i = String(index);
    card.innerHTML =
      '<div class="tpl-thumb"><div class="tpl-paper">' +
      tplThumb(entry) +
      '</div>' +
      tplChip('tpl-badge', entry.badge) +
      tplChip('tpl-size', tplSizeLabel(entry.template)) +
      '<div class="tpl-actions">' +
      '<button class="tpl-use" data-act="use" tabindex="-1">استفاده از این قالب</button>' +
      '<button class="tpl-peek" data-act="peek" tabindex="-1" aria-label="پیش‌نمایش بزرگ" ' +
      'title="پیش‌نمایش بزرگ در اندازهٔ واقعی">⤢</button>' +
      '</div></div><div class="tpl-meta"><strong>' +
      esc(entry.name) +
      '</strong><span>' +
      esc(entry.desc || '') +
      '</span></div>';
    card.title = 'لود قالب «' + entry.name + '» همراه دادهٔ نمونه‌اش';
    return card;
  }

  function renderGallery() {
    var terms = tplNorm(tplQuery).split(' ').filter(Boolean);
    tplVisible = tplEntries().filter(function (entry) {
      return tplMatches(entry, terms);
    });
    galleryCardsEl.innerHTML = '';
    tplVisible.forEach(function (entry, i) {
      galleryCardsEl.appendChild(buildTplCard(entry, i));
    });
    // the cards are in the DOM now, so the thumbs can be fitted to real widths
    fitAllThumbs();
    tplEmptyEl.classList.toggle('show', tplVisible.length === 0);
    tplCountEl.textContent = tplVisible.length
      ? faDigits(tplVisible.length) + ' قالب آماده'
      : 'بدون نتیجه';
    if (tplFocus >= tplVisible.length) tplFocus = 0;
    upgradeTooltips(galleryCardsEl);
  }
  // the grid reflows on resize, so the papers have to be re-fitted with it
  var tplRefitTimer = null;
  window.addEventListener('resize', function () {
    if (!galleryEl.classList.contains('show')) return;
    clearTimeout(tplRefitTimer);
    tplRefitTimer = setTimeout(fitAllThumbs, 120);
  });

  /** Category chips + palette swatches — built once, then only their state moves. */
  function renderTplChrome() {
    if (tplChromeReady) return;
    tplChromeReady = true;
    (window.PDFSTUDIO_TEMPLATE_CATEGORIES || []).forEach(function (cat) {
      var b = document.createElement('button');
      b.className = 'tpl-chip';
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.cat = cat.id;
      b.textContent = cat.name;
      tplCatsEl.appendChild(b);
    });
    (window.PDFSTUDIO_THEMES || []).forEach(function (theme) {
      var b = document.createElement('button');
      b.className = 'tpl-sw';
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.theme = theme.id;
      b.style.background = theme.css;
      b.title = 'پالت ' + theme.name;
      tplThemesEl.appendChild(b);
    });
    upgradeTooltips(tplThemesEl);
    syncTplChrome();
  }
  function syncTplChrome() {
    Array.prototype.forEach.call(tplCatsEl.querySelectorAll('.tpl-chip'), function (b) {
      b.setAttribute('aria-selected', b.dataset.cat === tplCat ? 'true' : 'false');
    });
    Array.prototype.forEach.call(tplThemesEl.querySelectorAll('.tpl-sw'), function (b) {
      b.setAttribute('aria-checked', b.dataset.theme === tplTheme ? 'true' : 'false');
    });
  }

  function setTplTheme(id) {
    tplTheme = id;
    try {
      window.localStorage.setItem(TPL_THEME_KEY, id);
    } catch (e) {
      /* private mode: the palette just won't persist */
    }
    syncTplChrome();
    renderGallery();
  }

  function loadGalleryTemplate(entry) {
    sampleData = JSON.parse(JSON.stringify(entry.data || {}));
    sampleEl.value = JSON.stringify(sampleData, null, 2);
    renderFieldPicker();
    loadTemplate(tplThemed(entry.template));
    galleryEl.classList.remove('show');
    tplZoomEl.classList.remove('show');
    setTab('design');
    toast('قالب «' + entry.name + '» لود شد', { type: 'success' });
  }

  function openTplZoom(entry) {
    tplZoomEntry = entry;
    document.getElementById('tplZoomTitle').textContent = entry.name;
    document.getElementById('tplZoomDesc').textContent = entry.desc || '';
    tplZoomStageEl.innerHTML = tplThumb(entry);
    tplZoomEl.classList.add('show');
  }

  function focusTplCard(i) {
    var cards = galleryCardsEl.querySelectorAll('.tpl-card');
    if (!cards.length) return;
    tplFocus = Math.max(0, Math.min(cards.length - 1, i));
    cards[tplFocus].focus();
  }

  galleryCardsEl.addEventListener('click', function (e) {
    var card = e.target.closest ? e.target.closest('.tpl-card') : null;
    if (!card) return;
    var entry = tplEntryById(card.dataset.template);
    if (!entry) return;
    var act = e.target.closest ? e.target.closest('[data-act]') : null;
    if (act && act.dataset.act === 'peek') {
      e.stopPropagation();
      openTplZoom(entry);
      return;
    }
    loadGalleryTemplate(entry);
  });
  galleryCardsEl.addEventListener('keydown', function (e) {
    var card = e.target.closest ? e.target.closest('.tpl-card') : null;
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      var entry = tplEntryById(card.dataset.template);
      if (entry) loadGalleryTemplate(entry);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusTplCard(Number(card.dataset.i) + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusTplCard(Number(card.dataset.i) - 1);
    }
  });

  tplCatsEl.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.tpl-chip') : null;
    if (!chip) return;
    tplCat = chip.dataset.cat;
    syncTplChrome();
    renderGallery();
  });
  tplThemesEl.addEventListener('click', function (e) {
    var sw = e.target.closest ? e.target.closest('.tpl-sw') : null;
    if (sw) setTplTheme(sw.dataset.theme);
  });
  tplSearchEl.addEventListener('input', function () {
    tplQuery = tplSearchEl.value;
    renderGallery();
  });
  tplSearchEl.addEventListener('keydown', function (e) {
    e.stopPropagation(); // never let Delete/arrows reach the canvas shortcuts
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      focusTplCard(0);
    } else if (e.key === 'Escape') {
      if (tplSearchEl.value) {
        tplSearchEl.value = '';
        tplQuery = '';
        renderGallery();
      } else galleryEl.classList.remove('show');
    }
  });
  document.getElementById('tplLucky').addEventListener('click', function () {
    var all = tplEntries().filter(function (t) {
      return t.id !== 'blank';
    });
    var themes = window.PDFSTUDIO_THEMES || [];
    if (!all.length) return;
    var pick = all[Math.floor(Math.random() * all.length)];
    if (themes.length) {
      tplTheme = themes[Math.floor(Math.random() * themes.length)].id;
      syncTplChrome();
    }
    loadGalleryTemplate(pick);
  });

  document.getElementById('openGallery').addEventListener('click', function () {
    renderTplChrome();
    renderGallery();
    galleryEl.classList.add('show');
    if (tplSearchEl.focus) tplSearchEl.focus();
  });
  document.getElementById('closeGallery').addEventListener('click', function () {
    galleryEl.classList.remove('show');
  });
  galleryEl.addEventListener('click', function (e) {
    if (e.target === galleryEl) galleryEl.classList.remove('show');
  });
  document.getElementById('closeTplZoom').addEventListener('click', function () {
    tplZoomEl.classList.remove('show');
  });
  document.getElementById('tplZoomUse').addEventListener('click', function () {
    if (tplZoomEntry) loadGalleryTemplate(tplZoomEntry);
  });
  tplZoomEl.addEventListener('click', function (e) {
    if (e.target === tplZoomEl) tplZoomEl.classList.remove('show');
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
  // Undo steps of the current session (distinct from the saved snapshots above).
  // The engine reports each step's command `type`; the Persian wording lives here
  // because `core` stays language-neutral.
  var STEP_LABELS = {
    addElement: 'افزودن الِمان',
    removeElement: 'حذف الِمان',
    patchElement: 'تغییر خواص',
    replaceElement: 'جایگزینی الِمان',
    modifyElement: 'ویرایش الِمان',
    setElementBounds: 'جابه‌جایی/اندازه',
    setElementsBounds: 'جابه‌جایی گروهی',
    moveElementsBy: 'جابه‌جایی با کیبورد',
    moveElementZ: 'تغییر ترتیب',
    renameElement: 'تغییر نامِ الِمان',
    setStaticText: 'ویرایش متن',
    groupElements: 'گروه‌بندی',
    ungroupContainer: 'باز کردنِ گروه',
    patchBand: 'تنظیمات باند',
    addBand: 'افزودن باند',
    removeBand: 'حذف باند',
    moveBand: 'جابه‌جایی باند',
    patchPage: 'تنظیمات صفحه',
    patchMetadata: 'تغییر نامِ سند',
    ensureStyles: 'افزودن سبک',
    ensureDataset: 'اعلانِ دیتاست',
    addStyle: 'افزودن سبک',
    updateStyle: 'ویرایش سبک',
    duplicateStyle: 'تکثیر سبک',
    removeStyle: 'حذف سبک',
    replaceTemplate: 'جایگزینی سند',
    composite: 'چند تغییر با هم',
  };
  function renderStepList() {
    var listEl = document.getElementById('stepList');
    if (!listEl) return;
    var steps = store.getHistory();
    if (!steps.length) {
      listEl.innerHTML = '<div class="layers-empty">هنوز تغییری در این نشست ندادی.</div>';
      return;
    }
    // newest first reads better, but the engine indexes oldest-first
    listEl.innerHTML = steps
      .slice()
      .reverse()
      .map(function (step, revIndex) {
        var index = steps.length - 1 - revIndex;
        return (
          '<div class="st-row"><span class="st-name">' +
          esc(STEP_LABELS[step.type] || step.type) +
          '</span><span class="st-meta">' +
          (revIndex === 0 ? 'الان' : index + 1) +
          '</span>' +
          '<button class="st-act" data-step="' +
          index +
          '" title="برگرد به وضعیتِ بعد از این گام">برگرد</button></div>'
        );
      })
      .join('');
    upgradeTooltips(listEl);
  }
  document.getElementById('openHistory').addEventListener('click', function () {
    renderHistory();
    renderStepList();
    historyEl.classList.add('show');
  });
  document.getElementById('closeHistory').addEventListener('click', function () {
    historyEl.classList.remove('show');
  });
  historyEl.addEventListener('click', function (e) {
    if (e.target === historyEl) return historyEl.classList.remove('show');
    var stepBtn = e.target.closest ? e.target.closest('[data-step]') : null;
    if (stepBtn) {
      store.undoTo(Number(stepBtn.dataset.step));
      selected = [];
      renderInspector();
      renderStepList();
      return;
    }
    var btn = e.target.closest ? e.target.closest('[data-hist]') : null;
    if (!btn) return;
    var entry = readHistory()[Number(btn.dataset.hist)];
    if (!entry) return;
    var res = P.importTemplate(entry.json);
    if (res.success) {
      loadTemplate(res.value);
      historyEl.classList.remove('show');
      toast('نسخهٔ انتخابی بازگردانی شد', { type: 'success' });
    } else {
      toast('این نسخه قابل بازگردانی نیست');
    }
  });

  // --- AI copilot (ROADMAP ۳.۲–۳.۳) ---------------------------------------------
  var copilotEl = document.getElementById('copilot');
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
    setLoading(document.getElementById('cpRun'), true);
    statusEl.textContent = 'در حال ساخت… (ممکن است تا یک دقیقه طول بکشد)';
    var opts = { prompt: promptText, provider: provider, sampleData: sampleData };
    if (mode !== 'new') opts.currentTemplate = store.getState();
    P.generateTemplate(opts)
      .then(function (res) {
        cpBusy = false;
        setLoading(document.getElementById('cpRun'), false);
        if (!res.success) {
          statusEl.textContent = /429|rate.?limit/i.test(res.error)
            ? 'سقف رایگان سرویس فعلاً پر شد — یکی دو دقیقه صبر کن و دوباره بزن، یا مدل سبک‌تر (مثل llama-3.1-8b-instant) یا سرویس Gemini را انتخاب کن.'
            : 'نشد: ' + res.error.slice(0, 180);
          return;
        }
        bumpUid(res.template);
        store.dispatch(P.replaceTemplate(res.template));
        selected = [];
        copilotEl.classList.remove('show');
        statusEl.textContent = '';
        setTab('design');
        toast(
          'کوپایلوت قالب را ' +
            (mode === 'new' ? 'ساخت' : 'به‌روزرسانی کرد') +
            ' (تلاش ' +
            res.attempts +
            ')',
          {
            type: 'success',
            action: {
              label: 'واگرد',
              onClick: function () {
                store.undo();
              },
            },
          },
        );
      })
      .catch(function (err) {
        cpBusy = false;
        setLoading(document.getElementById('cpRun'), false);
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
      toast('لینک اشتراک کپی شد (' + Math.round(url.length / 1024) + 'KB)', { type: 'success' });
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
      toast('قالب از لینک اشتراک لود شد', { type: 'success' });
      return true;
    } catch (err) {
      return false;
    }
  }
  window.addEventListener('hashchange', tryLoadFromHash);

  // --- live data from a URL (ROADMAP ۲.۲) --------------------------------------
  var liveBusy = false;
  document.getElementById('liveFetch').addEventListener('click', function () {
    if (liveBusy) return;
    var url = document.getElementById('liveUrl').value.trim();
    if (!url) return toast('اول آدرس API را بنویس');
    var btn = this;
    liveBusy = true;
    setLoading(btn, true);
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
        toast('دادهٔ زنده دریافت شد', { type: 'success' });
      })
      .catch(function (err) {
        toast('دریافت داده ناموفق بود: ' + err.message, true);
      })
      .finally(function () {
        liveBusy = false;
        setLoading(btn, false);
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
    } else if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      // Ctrl+G groups the selection, Ctrl+Shift+G dissolves the selected group
      e.preventDefault();
      e.shiftKey ? ungroupSelected() : groupSelected();
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
      // the big preview sits on top of the gallery, so it closes first
      if (tplZoomEl.classList.contains('show')) return tplZoomEl.classList.remove('show');
      if (galleryEl.classList.contains('show')) return galleryEl.classList.remove('show');
      if (exitGroup()) return; // step out of a group before dropping the selection
      selected = [];
      renderInspector();
      renderCanvas();
    } else if (!editing && selected.length && /^Arrow/.test(e.key)) {
      e.preventDefault();
      var step = e.shiftKey ? 10 : 1;
      var dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      var dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      var nudgeable = unlockedSelection();
      if (nudgeable.length) store.dispatch(P.moveElementsBy(nudgeable, dx, dy));
      else lockedNudge();
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
      store.dispatch(P.renameTemplate(docNameEl.value.trim()));
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
    document.getElementById('pageUnit').value = pg.unit || 'pt';
    document.getElementById('pageDigits').value = pg.locale.digits;
    document.getElementById('pageCalendar').value = pg.locale.calendar;
    // the unit applies to these fields, so say which one is active next to them
    document.querySelectorAll('.unit-tag').forEach(function (tag) {
      tag.textContent = '(' + unitLabel(store.getState()) + ')';
    });
    document.getElementById('customSizeRow').style.display = isCustom ? '' : 'none';
    if (isCustom) {
      var wInp = document.getElementById('pageW');
      var hInp = document.getElementById('pageH');
      if (document.activeElement !== wInp) wInp.value = toDisplay(pg.size.width);
      if (document.activeElement !== hInp) hInp.value = toDisplay(pg.size.height);
    }
    // never overwrite the box being typed into, or the caret jumps
    Object.keys(MARGIN_INPUTS).forEach(function (side) {
      var inp = MARGIN_INPUTS[side];
      if (document.activeElement !== inp) inp.value = toDisplay(pg.margins[side]);
    });
    if (document.activeElement !== docNameEl) {
      docNameEl.value = store.getState().metadata.name || 'سند بی‌نام';
    }
    // before the canvas: the SVG names families and the browser has to already
    // know them, or the preview falls back while the PDF prints correctly (1.4)
    syncFontFaces(store.getState());
    renderCanvas();
    renderLayers();
    renderStyleList();
    renderFontList();
    renderStatus();
    renderPreview();
    scheduleDiagnostics();
    updateVerifyUi();
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
  /**
   * Swap the document in place. Replacing the whole template is a single
   * engine command, so the store (and its one subscription) lives for the
   * session — and loading a gallery template or a Copilot result stays
   * undoable instead of silently discarding the user's work.
   */
  function loadTemplate(t) {
    bumpUid(t);
    activeBand = 0;
    store.dispatch(P.replaceTemplate(t));
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
  // --- inspector drawer on narrow layouts (design-review ۲.۱) ---------------
  // Below the tablet breakpoint the inspector floats over the canvas instead of
  // stealing width. CSS owns the geometry; this only tracks open/closed and
  // keeps the toggle's aria-expanded honest.
  var panelToggle = document.getElementById('togglePanel');
  var panelScrim = document.getElementById('panelScrim');
  // The drawer and the preview overlay start just below the top bar. Its height
  // is a CSS token, but on a phone the bar wraps to two rows — so measure it
  // instead of trusting the constant, or the overlays sit misaligned.
  var topbarEl = document.querySelector('.topbar');
  function syncTopbarHeight() {
    if (!topbarEl) return;
    var h = topbarEl.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty('--topbar-h', h + 'px');
  }
  if (window.ResizeObserver && topbarEl) new ResizeObserver(syncTopbarHeight).observe(topbarEl);
  else window.addEventListener('resize', syncTopbarHeight);
  syncTopbarHeight();
  /** True when the layout is narrow enough that the inspector is a drawer. */
  function isDrawerLayout() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
  }
  function setPanelOpen(open) {
    if (open) document.body.dataset.panel = 'open';
    else delete document.body.dataset.panel;
    if (panelToggle) panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (panelToggle)
    panelToggle.addEventListener('click', function () {
      setPanelOpen(document.body.dataset.panel !== 'open');
    });
  if (panelScrim)
    panelScrim.addEventListener('click', function () {
      setPanelOpen(false);
    });
  var closePanelBtn = document.getElementById('closePanel');
  if (closePanelBtn)
    closePanelBtn.addEventListener('click', function () {
      setPanelOpen(false);
    });
  // Escape closes the drawer before anything else would react to it
  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Escape' && document.body.dataset.panel === 'open') {
        e.stopPropagation();
        setPanelOpen(false);
      }
    },
    true,
  );
  // widening the window hands the panel back to the layout
  if (window.matchMedia) {
    var wide = window.matchMedia('(min-width: 901px)');
    var onWide = function (e) {
      if (e.matches) setPanelOpen(false);
    };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    else if (wide.addListener) wide.addListener(onWide);
  }

  installModalA11y();
  upgradeTooltips(document);
  renderFieldPicker();
  renderSnippetList(); // library-backed, so it does not ride the store's rerender
  // On a phone an A4 page at 100% is wider than the viewport, so the first thing
  // the user would see is a corner of it. Fit once, then leave zoom to them.
  if (isDrawerLayout()) {
    var fitBtn = document.getElementById('zoomFit');
    if (fitBtn) fitBtn.click();
  }
  if (!tryLoadFromHash() && !restoreDraft()) {
    rerender();
    renderInspector();
  }
})();
