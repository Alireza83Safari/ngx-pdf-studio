/**
 * The designer's pure logic — no DOM, no store, no globals.
 *
 * `designer.js` is one long IIFE, so nothing inside it can be reached from a
 * test: ~5,500 lines had a single jsdom smoke test between them, and that smoke
 * test cannot isolate a wrong formula from a wrong wiring (designer-ux 4.1).
 * Everything here takes its inputs as arguments and returns a value, so it can
 * be asserted directly.
 *
 * Loaded as a plain script before `designer.js` (as `window.DesignerUtil`) and
 * required straight from the tests (as `module.exports`).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesignerUtil = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- snapping -------------------------------------------------------------

  /** Grid step in points, and how close an edge has to be to win over it. */
  var GRID = 5;
  var SNAP_EDGE = 4;

  /**
   * Snap one coordinate: to a neighbouring element's edge when close enough,
   * otherwise to the grid. Returns the guide line to draw, or null when the
   * value merely landed on the grid — the guide means "you are aligned with
   * something", so the grid must not claim one.
   */
  function snapValue(v, edges, disabled) {
    if (disabled) return { v: v, guide: null };
    for (var i = 0; i < (edges || []).length; i++) {
      if (Math.abs(edges[i] - v) <= SNAP_EDGE) return { v: edges[i], guide: edges[i] };
    }
    return { v: Math.round(v / GRID) * GRID, guide: null };
  }

  // --- display units (designer-ux 1.6) --------------------------------------

  // The model stores points, always. `page.unit` is a display convenience and
  // the engine ignores it, so this converts on the way in and out of the number
  // fields and nothing else.
  var UNITS = {
    pt: { perPt: 1, decimals: 0, label: 'pt' },
    mm: { perPt: 25.4 / 72, decimals: 1, label: 'mm' },
    cm: { perPt: 2.54 / 72, decimals: 2, label: 'cm' },
  };

  function unitOf(unit) {
    return UNITS[unit || 'pt'] || UNITS.pt;
  }

  /** Points → the display unit, rounded to what that unit can usefully show. */
  function toDisplay(pt, unit) {
    var u = unitOf(unit);
    var f = Math.pow(10, u.decimals);
    return Math.round(pt * u.perPt * f) / f;
  }

  /** A number typed in the display unit → points. */
  function fromDisplay(value, unit) {
    return Number(value) / unitOf(unit).perPt;
  }

  function unitLabel(unit) {
    return unitOf(unit).label;
  }

  // --- bands (designer-ux 0.1) ----------------------------------------------

  /**
   * The strip a band owns, mirroring the engine's own `bandHeight()`: a `fixed`
   * band is exactly its declared value however tall its content is; an `auto`
   * band grows to its content, clamped by min/max.
   */
  function resolveBandHeight(band, contentBottom) {
    var h = (band && band.height) || { mode: 'auto' };
    if (h.mode === 'fixed') return h.value;
    var min = h.min == null ? 0 : h.min;
    var max = h.max == null ? Infinity : h.max;
    return Math.min(max, Math.max(min, contentBottom));
  }

  /** Background/watermark bands span the page by contract — overflow is meaningless. */
  function isPageWideBand(band) {
    return !!band && (band.type === 'background' || band.type === 'watermark');
  }

  // --- resizing (designer-ux 1.8) -------------------------------------------

  /** Which edges each grip drags. A corner moves two, an edge handle one. */
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
   * Where a resize drag lands. Pure: the caller supplies `snapX`/`snapY`, which
   * is how snapping and guide lines stay out of the geometry.
   *
   * The edges a grip does not sit on never move — that is what makes a top-left
   * handle grow the box upward instead of sliding it — and no edge may cross
   * its opposite, so the box shrinks to `MIN_SIZE` rather than inverting.
   */
  function resizeBounds(start, dir, dx, dy, opts) {
    var o = opts || {};
    var snapX = o.snapX || identitySnap;
    var snapY = o.snapY || identitySnap;
    var pulls = RESIZE_EDGES[dir] || RESIZE_EDGES.se;

    var left = start.x;
    var top = start.y;
    var right = start.x + start.width;
    var bottom = start.y + start.height;
    var guideX = null;
    var guideY = null;

    if (pulls.left) {
      var sl = snapX(start.x + dx);
      left = Math.min(sl.v, right - MIN_SIZE);
      guideX = sl.guide;
    }
    if (pulls.right) {
      var sr = snapX(right + dx);
      right = Math.max(sr.v, left + MIN_SIZE);
      guideX = sr.guide;
    }
    if (pulls.top) {
      var st = snapY(start.y + dy);
      top = Math.min(st.v, bottom - MIN_SIZE);
      guideY = st.guide;
    }
    if (pulls.bottom) {
      var sb = snapY(bottom + dy);
      bottom = Math.max(sb.v, top + MIN_SIZE);
      guideY = sb.guide;
    }

    var width = right - left;
    var height = bottom - top;

    // Keeping the proportions: the dominant axis wins so the box follows the
    // pointer rather than fighting it, and an edge grip (which drives one axis)
    // derives the other.
    if (o.keepRatio && start.width > 0 && start.height > 0) {
      var ratio = start.width / start.height;
      var drivesX = pulls.left || pulls.right;
      var drivesY = pulls.top || pulls.bottom;
      if (drivesX && drivesY) {
        if (width / ratio > height) height = width / ratio;
        else width = height * ratio;
      } else if (drivesX) height = width / ratio;
      else if (drivesY) width = height * ratio;
      // re-anchor to whichever edges are NOT being dragged
      if (pulls.left) left = right - width;
      if (pulls.top) top = bottom - height;
    }

    return {
      bounds: {
        x: left,
        y: top,
        width: Math.max(MIN_SIZE, width),
        height: Math.max(MIN_SIZE, height),
      },
      guideX: guideX,
      guideY: guideY,
    };
  }

  function identitySnap(v) {
    return { v: v, guide: null };
  }

  // --- images (designer-ux 1.3) ---------------------------------------------

  /**
   * A default box for a dropped picture, at its own aspect ratio: capped at
   * 180pt wide, then at 240pt tall for a portrait image. An image whose
   * intrinsic size could not be read falls back to a plain rectangle.
   */
  function fitImageBox(natW, natH) {
    var MAXW = 180;
    var MAXH = 240;
    if (!(natW > 0) || !(natH > 0)) return { width: MAXW, height: 120 };
    var w = MAXW;
    var h = Math.round((natH / natW) * MAXW);
    if (h > MAXH) {
      h = MAXH;
      w = Math.round((natW / natH) * MAXH);
    }
    return { width: w, height: h };
  }

  // --- data paths (field picker) --------------------------------------------

  /**
   * Every bindable path in the sample data. An array of objects contributes
   * `items[0].field` for each of the first row's keys plus `len(items)`, since
   * those are the two things a template actually binds to.
   */
  function dataPaths(obj, prefix, out) {
    out = out || [];
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

  return {
    GRID: GRID,
    SNAP_EDGE: SNAP_EDGE,
    snapValue: snapValue,
    UNITS: UNITS,
    unitOf: unitOf,
    toDisplay: toDisplay,
    fromDisplay: fromDisplay,
    unitLabel: unitLabel,
    resolveBandHeight: resolveBandHeight,
    isPageWideBand: isPageWideBand,
    RESIZE_EDGES: RESIZE_EDGES,
    MIN_SIZE: MIN_SIZE,
    resizeBounds: resizeBounds,
    fitImageBox: fitImageBox,
    dataPaths: dataPaths,
  };
});
