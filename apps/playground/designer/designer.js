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

  var store = new P.DocumentStore(freshTemplate());

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
  function update(id, updater) {
    var loc = P.findElement(store.getState(), id);
    if (!loc) return;
    var before = loc.element;
    store.dispatch({
      type: 'update',
      apply: function (t) {
        return P.updateElement(t, id, function (e) {
          return updater(Object.assign({}, e));
        });
      },
      invert: function () {
        return restoreCmd(id, before);
      },
    });
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
    var zs = t.bands[0].elements.map(function (e) {
      return e.zIndex || 1;
    });
    var z = front ? Math.max.apply(null, zs) + 1 : Math.min.apply(null, zs) - 1;
    selected.forEach(function (id) {
      update(id, function (e) {
        e.zIndex = z;
        return e;
      });
    });
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
        value: { source: 'customer.name' },
        typography: { fontFamily: 'Vazirmatn', fontSize: 13 },
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
  };

  function addElement(type) {
    var id = 'el-' + uid++;
    var base = { id: id, bounds: { x: 40, y: 80, width: 200, height: 24 }, zIndex: 1 };
    var make = DEFAULTS[type] || DEFAULTS.staticText;
    // select first: the store notifies synchronously on dispatch and the
    // subscribers read the selection when re-rendering.
    selected = [id];
    store.dispatch(P.addElement('main', make(base)));
  }

  function duplicateSelected() {
    var t = store.getState();
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
      store.dispatch(P.addElement('main', copy));
      fresh.push(copy.id);
    });
    if (fresh.length) {
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

  function renderCanvas() {
    var t = store.getState();
    var size = pageSize(t);
    pageEl.style.width = size.width * zoom + 'px';
    pageEl.style.height = size.height * zoom + 'px';
    var m = t.page.margins;
    marginsEl.style.left = m.left * zoom + 'px';
    marginsEl.style.top = m.top * zoom + 'px';
    marginsEl.style.right = m.right * zoom + 'px';
    marginsEl.style.bottom = m.bottom * zoom + 'px';

    // WYSIWYG layer: the engine's own SVG painting of page 1 (§7).
    try {
      var doc = P.layoutDocument(displayTemplate(t), { data: sampleData });
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
    var band = t.bands[0];
    band.elements.forEach(function (el) {
      var node = document.createElement('div');
      node.className = 'el' + (isSelected(el.id) ? ' selected' : '');
      node.dataset.id = el.id;
      node.title = el.type;
      var b = el.bounds;
      node.style.left = (m.left + b.x) * zoom + 'px';
      node.style.top = (m.top + b.y) * zoom + 'px';
      node.style.width = Math.max(4, b.width * zoom) + 'px';
      node.style.height = Math.max(4, b.height * zoom) + 'px';
      pageEl.appendChild(node);
      if (selected.length === 1 && isSelected(el.id)) {
        var handle = document.createElement('div');
        handle.className = 'handle';
        handle.dataset.resize = el.id;
        node.appendChild(handle);
      }
    });
    document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
  }

  // --- snapping ------------------------------------------------------------
  function snapEdges(t, excludeIds) {
    var xs = [];
    var ys = [];
    t.bands[0].elements.forEach(function (el) {
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
      };
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
    selected = t.bands[0].elements
      .filter(function (el) {
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
    drag.ids.forEach(function (id) {
      var b0 = drag.starts[id];
      if (!b0) return;
      store.dispatch(
        P.setElementBounds(
          id,
          { x: b0.x + fx, y: b0.y + fy, width: b0.width, height: b0.height },
          true,
        ),
      );
    });
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
          '<span class="fp-item" draggable="true" data-path="' + esc(p) + '">' + esc(p) + '</span>'
        );
      })
      .join('');
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
  pageEl.addEventListener('drop', function (e) {
    e.preventDefault();
    var path = e.dataTransfer.getData('text/plain');
    if (!path) return;
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
      P.addElement('main', {
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

  function renderInspector() {
    var t = store.getState();
    var id = lastSelected();
    var loc = id ? P.findElement(t, id) : null;
    if (!loc) {
      inspectorEl.innerHTML =
        '<p class="empty">یک المان را انتخاب کن یا از نوار بالا اضافه کن.<br>Shift+کلیک: چندانتخابی · فلش‌ها: جابه‌جایی · Ctrl+D: کپی</p>';
      return;
    }
    var el = loc.element,
      b = el.bounds,
      ty = el.typography || {};
    var multi = selected.length > 1 ? ' <small>(' + selected.length + ' انتخاب)</small>' : '';
    var html = '<h2>' + el.type + multi + '</h2>';
    if (selected.length > 1) {
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
    }
    html +=
      '<div class="btnrow">' +
      '<button data-z="front" title="بیار جلو">⬆ جلو</button>' +
      '<button data-z="back" title="بفرست عقب">⬇ عقب</button>' +
      '</div>';
    html +=
      '<div class="grid2">' +
      numField('x', b.x) +
      numField('y', b.y) +
      numField('w', b.width) +
      numField('h', b.height) +
      '</div>';
    html += field(
      'چرخش',
      '<input type="number" data-prop="rotation" value="' + (el.rotation || 0) + '">',
    );

    if (el.type === 'staticText')
      html += field('متن', '<input data-prop="text" value="' + esc(el.text || '') + '">');
    if (el.type === 'dataField' || el.type === 'barcode' || el.type === 'qrcode')
      html += field(
        el.type === 'dataField' ? 'بایند' : 'مقدار',
        '<input data-prop="source" value="' + esc(el.value ? el.value.source : '') + '">',
      );
    if (el.type === 'barcode')
      html += field(
        'symbology',
        '<select data-prop="symbology">' +
          opts(['code128', 'code39', 'ean13'], el.symbology) +
          '</select>',
      );
    if (el.type === 'image') {
      html += field(
        'آدرس',
        '<input data-prop="imgsource" value="' + esc(el.source ? el.source.source : '') + '">',
      );
      html += field(
        'fit',
        '<select data-prop="fit">' +
          opts(['contain', 'cover', 'fill', 'none'], el.fit || 'contain') +
          '</select>',
      );
    }
    if (el.type === 'chart') {
      html += field(
        'نوع',
        '<select data-prop="chartKind">' +
          opts(['column', 'bar', 'line', 'stackedColumn', 'area', 'pie', 'donut'], el.chartKind) +
          '</select>',
      );
      html += field('دیتاست', '<input data-prop="dataset" value="' + esc(el.dataset || '') + '">');
      html += field(
        'دسته‌ها',
        '<input data-prop="categories" value="' +
          esc(el.categories ? el.categories.source : '') +
          '">',
      );
      html += field(
        'مقادیر',
        '<input data-prop="values" value="' +
          esc(el.series && el.series[0] ? el.series[0].values.source : '') +
          '">',
      );
    }
    if (el.type === 'line') {
      html += field(
        'رنگ خط',
        '<input type="color" data-prop="stroke" value="' +
          rgbToHex(el.stroke ? el.stroke.color : rgb(51, 65, 85)) +
          '">',
      );
    }
    if (el.type === 'rectangle' || el.type === 'ellipse') {
      var fill = el.box && el.box.fill ? rgbToHex(el.box.fill.color) : '#f1f5f9';
      html += field('پُری', '<input type="color" data-prop="fill" value="' + fill + '">');
    }
    if (
      el.type === 'staticText' ||
      el.type === 'dataField' ||
      el.type === 'richText' ||
      el.type === 'pageField'
    ) {
      html += field(
        'اندازه',
        '<input type="number" data-prop="fontSize" value="' + (ty.fontSize || 12) + '">',
      );
      html += field(
        'رنگ',
        '<input type="color" data-prop="color" value="' +
          rgbToHex(ty.color || rgb(15, 23, 42)) +
          '">',
      );
      html += field(
        'ضخیم',
        '<input type="checkbox" data-prop="bold"' +
          (ty.fontWeight === 'bold' ? ' checked' : '') +
          '>',
      );
      html += field(
        'چینش',
        '<select data-prop="align">' +
          opts(['start', 'center', 'end'], ty.align || 'start') +
          '</select>',
      );
    }
    html +=
      '<div class="row"><button id="dupEl" style="flex:1">کپی (Ctrl+D)</button>' +
      '<button id="deleteEl" style="flex:1;color:#b91c1c">حذف</button></div>';
    inspectorEl.innerHTML = html;
    wireInspector(el);
  }
  function numField(k, v) {
    return (
      '<div class="row"><label>' +
      k +
      '</label><input type="number" data-bound="' +
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
    bindProp('imgsource', function (e, v) {
      e.source = { source: v };
    });
    bindProp('fit', function (e, v) {
      e.fit = v;
    });
    bindProp('symbology', function (e, v) {
      e.symbology = v;
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
    bindProp('rotation', function (e, v) {
      e.rotation = Number(v) || 0;
    });
    bindProp('fontSize', function (e, v) {
      e.typography = Object.assign({}, e.typography, { fontSize: Number(v) });
    });
    bindProp('color', function (e, v) {
      e.typography = Object.assign({}, e.typography, { color: hexToRgb(v) });
    });
    bindProp('align', function (e, v) {
      e.typography = Object.assign({}, e.typography, { align: v });
    });
    bindProp('fill', function (e, v) {
      e.box = Object.assign({}, e.box, { fill: { color: hexToRgb(v) } });
    });
    bindProp('stroke', function (e, v) {
      e.stroke = Object.assign({ width: 1.5 }, e.stroke, { color: hexToRgb(v) });
    });
    var boldInp = inspectorEl.querySelector('[data-prop="bold"]');
    if (boldInp)
      boldInp.addEventListener('change', function () {
        update(id, function (e) {
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
    if (del)
      del.addEventListener('click', function () {
        selected.slice().forEach(function (sid) {
          store.dispatch(P.removeElementById(sid));
        });
        selected = [];
      });
    function bindProp(prop, mut) {
      var inp = inspectorEl.querySelector('[data-prop="' + prop + '"]');
      if (!inp || prop === 'bold') return;
      inp.addEventListener('change', function () {
        update(id, function (e) {
          mut(e, inp.value);
          return e;
        });
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
        diagEl.textContent =
          'JSON نامعتبر:\n' +
          res.issues
            .map(function (i) {
              return i.path + ': ' + i.message;
            })
            .join('\n');
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
    } catch (err) {
      diagEl.textContent = err.message;
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
  try {
    if (window.localStorage.getItem(THEME_KEY) === 'dark') applyTheme('dark');
  } catch (err) {
    /* ignore */
  }

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
    selected.slice().forEach(function (sid) {
      store.dispatch(P.removeElementById(sid));
    });
    selected = [];
  }

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
      card.addEventListener('click', function () {
        loadGalleryTemplate(entry);
      });
      galleryCardsEl.appendChild(card);
    });
  }
  function loadGalleryTemplate(entry) {
    sampleData = JSON.parse(JSON.stringify(entry.data || {}));
    sampleEl.value = JSON.stringify(sampleData, null, 2);
    renderFieldPicker();
    loadTemplate(JSON.parse(JSON.stringify(entry.template)));
    galleryEl.classList.remove('show');
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
    autosaveTimer = setTimeout(function () {
      try {
        window.localStorage.setItem(DRAFT_KEY, P.serializeTemplate(store.getState()));
      } catch (err) {
        /* storage unavailable (private mode / file://) — skip silently */
      }
    }, 400);
  }
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
  document.getElementById('newDoc').addEventListener('click', function () {
    if (!window.confirm('سند جدید؟ طرح فعلی پاک می‌شود (پیش‌نویس هم).')) return;
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      /* ignore */
    }
    loadTemplate(freshTemplate());
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
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selected.length) {
      e.preventDefault();
      duplicateSelected();
    } else if (e.key === 'Escape') {
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
      selected.slice().forEach(function (sid) {
        store.dispatch(P.removeElementById(sid));
      });
      selected = [];
    }
  });

  // --- wiring --------------------------------------------------------------
  function rerender() {
    document.getElementById('undo').disabled = !store.canUndo();
    document.getElementById('redo').disabled = !store.canRedo();
    document.getElementById('pageDir').value = store.getState().page.direction;
    renderCanvas();
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
  renderFieldPicker();
  if (!restoreDraft()) {
    rerender();
    renderInspector();
  }
})();
