/**
 * Reading the template model, and naming what is in it — no DOM, no store.
 *
 * The second extraction out of `designer.js` (designer-ux 4.2), after
 * `designer-util.js` took the geometry and the codecs. The seam this time is
 * *interpretation*: functions that answer "what does this element actually say"
 * — which border sides are on, what to call this thing in the layers panel,
 * where a new element can go without landing on top of something.
 *
 * That logic was invisible to tests. It lived inside one long IIFE whose only
 * coverage is a jsdom smoke test, and a smoke test cannot tell a wrong rule from
 * wrong wiring: `borderFacts` deciding that `all` means all four sides, and
 * `nextSpot` scanning downward for free space, are rules with edge cases and
 * neither had ever been asserted.
 *
 * Loaded as a plain script before `designer.js` (as `window.DesignerModel`) and
 * required straight from the tests (as `module.exports`).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesignerModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- escaping -------------------------------------------------------------

  /**
   * Escape a value for HTML — text or attribute, one function for both.
   *
   * There used to be two of these in `designer.js`, escaping different sets:
   * one did `& " <`, the other `& < >`. Whichever you reached for, something
   * went through unescaped, and which one you got depended on where in a
   * 6,000-line file you happened to be. This escapes everything either of them
   * did, so the answer no longer varies by call site.
   */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return c === '&'
        ? '&amp;'
        : c === '<'
          ? '&lt;'
          : c === '>'
            ? '&gt;'
            : c === '"'
              ? '&quot;'
              : '&#39;';
    });
  }

  // --- colour ---------------------------------------------------------------

  function rgb(r, g, b) {
    return { space: 'rgb', r: r, g: g, b: b };
  }

  /** `#rrggbb` → the model's colour shape. Anything else is black, not a throw. */
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return rgb(0, 0, 0);
    var n = parseInt(m[1], 16);
    return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }

  /** The model's colour shape → `#rrggbb`, for an `<input type="color">`. */
  function rgbToHex(c) {
    if (!c || c.space !== 'rgb') return '#000000';
    function h(v) {
      return ('0' + Math.round(v).toString(16)).slice(-2);
    }
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  /** Base64 → bytes, for the bundled font and for dropped assets. */
  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // --- naming ---------------------------------------------------------------

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

  /** The Persian name for an element type; an unknown type keeps its own name. */
  function faName(type) {
    return FA_NAMES[type] || type;
  }

  /**
   * What the layers panel calls an element.
   *
   * An author-given name always wins — that is the whole point of naming one —
   * and everything below it is a guess that should describe rather than repeat:
   * the text for a label, the binding for a field, the child count for a group.
   */
  function layerLabel(el) {
    if (el.name) return el.name;
    if (el.type === 'staticText' && el.text) return el.text;
    if (el.value && el.value.source) return el.value.source;
    if (el.type === 'chart') return faName(el.type) + ' · ' + (el.chartKind || '');
    if (el.type === 'container') {
      return faName(el.type) + ' · ' + (el.children || []).length + ' الِمان';
    }
    return faName(el.type);
  }

  // A labeled field is a container whose caption is its first staticText child
  // and whose value is its first dataField child.
  function childOfType(el, type) {
    return (el.children || []).filter(function (c) {
      return c.type === type;
    })[0];
  }
  function labeledLabel(el) {
    return childOfType(el, 'staticText');
  }
  function labeledValue(el) {
    return childOfType(el, 'dataField');
  }

  // --- icons ----------------------------------------------------------------

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

  /** Inline SVG for a type; an unmapped type gets a plain box rather than nothing. */
  function typeIcon(type, size) {
    var d = ICON_PATHS[type] || '<rect x="4" y="4" width="12" height="12" rx="2"/>';
    return (
      '<svg width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      d +
      '</svg>'
    );
  }

  // --- reading the box ------------------------------------------------------

  var BOX_SIDES = ['top', 'right', 'bottom', 'left'];

  /**
   * Read the border facts back out of the model for the box panel.
   *
   * A `BorderSet` is either one `all` side or a mix of named sides, so the panel
   * shows a single colour/width/style plus which edges are on — and `all` reads
   * as all four.
   *
   * Width is the on/off switch; the side toggles only choose which edges a
   * border covers. With no border yet they default to all four, so typing a
   * width alone produces the box the user expects — otherwise the width would
   * have nowhere to live and would snap back to 0 on the next render.
   *
   * `toDisplay` is passed in because padding is the one value here in document
   * units, and the unit conversion belongs to the document, not to this.
   */
  function borderFacts(el, toDisplay) {
    var convert = toDisplay || Number;
    var bx = el.box || {};
    var bd = bx.border || {};
    var ref = bd.all || bd.top || bd.right || bd.bottom || bd.left || null;
    var on = {};
    BOX_SIDES.forEach(function (side) {
      on[side] = ref ? (bd.all ? true : !!bd[side]) : true;
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
      // the model carries four sides; the panel edits them together, and reads
      // back the top as representative
      padding: bx.padding ? convert(bx.padding.top || 0) : '',
    };
  }

  // --- placing a new element -------------------------------------------------

  /** How far down to step while looking for free space, and when to give up. */
  var SCAN_STEP = 8;
  var SCAN_LIMIT = 500;

  /**
   * First free position (content-left, scanning downward) for a new element, so
   * clicking a toolbox tool never drops a box on top of the title or whatever
   * else is already there.
   *
   * The guard matters: a band packed edge to edge has no free row, and without a
   * limit this walks down forever rather than admitting it and overlapping.
   */
  function nextSpot(siblings, w, h) {
    var els = siblings || [];
    var W = w || 200;
    var H = h || 24;
    var x = 0;
    var y = 0;
    var guard = 0;
    var hit = function (yy) {
      return els.some(function (e) {
        var b = e.bounds;
        return !(x + W <= b.x || x >= b.x + b.width || yy + H <= b.y || yy >= b.y + b.height);
      });
    };
    while (hit(y) && guard++ < SCAN_LIMIT) y += SCAN_STEP;
    return { x: x, y: Math.round(y) };
  }

  // --- showing bindings instead of values ------------------------------------

  /**
   * The canvas can show bound sample values (the default) or the raw binding
   * names. The second is produced by rewriting every `dataField` into the
   * `staticText` that names it, so the *engine* renders both modes and the two
   * cannot drift apart — a separate "draw the binding name" path in the canvas
   * is exactly the kind of second renderer this project exists not to have.
   */
  function displayTemplate(t, showValues) {
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

  return {
    esc: esc,
    rgb: rgb,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    base64ToBytes: base64ToBytes,
    FA_NAMES: FA_NAMES,
    faName: faName,
    layerLabel: layerLabel,
    labeledLabel: labeledLabel,
    labeledValue: labeledValue,
    typeIcon: typeIcon,
    borderFacts: borderFacts,
    nextSpot: nextSpot,
    displayTemplate: displayTemplate,
  };
});
