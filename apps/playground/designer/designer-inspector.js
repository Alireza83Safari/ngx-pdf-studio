/**
 * The inspector's HTML, for the parts that are a function of the model alone.
 *
 * The sixth cut of designer-ux 4.2. `renderInspector` is ~500 lines that read
 * `store`, `selected`, `activeBand` and the DOM as it goes, so it does not move
 * as one piece — but two whole panels inside it are pure: the band bar and
 * settings (a function of the template plus which band is active) and the box
 * panel (a function of one element). Those come out here.
 *
 * Why these two first, and why now: `model-coverage.spec.js` already fails the
 * build when a style property has no control in the inspector, so every field
 * below is guaranteed to *exist*. Nothing guaranteed it was **built right** —
 * the smoke test drives 10 of the inspector's 44 controls, and none of the box
 * panel's nine. A checkbox rendered without `checked`, a `<select>` with no
 * `selected` option, a number field showing points in a millimetre document:
 * all of those pass a coverage grep and are wrong on screen.
 *
 * Every function takes what it reads. That is the whole point — the reason the
 * rest of `renderInspector` has never been testable is that it reads state it
 * was not given.
 *
 * Loaded as a plain script before `designer.js` (as `window.DesignerInspector`)
 * and required straight from the tests (as `module.exports`).
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var model = isNode ? require('./designer-model') : root.DesignerModel;
  var api = factory(model);
  if (isNode) module.exports = api;
  else root.DesignerInspector = api;
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  var esc = M.esc;

  // --- shared builders ------------------------------------------------------

  /** One labelled row. Every control in the inspector is one of these. */
  function field(label, inputHtml) {
    return '<div class="row"><label>' + label + '</label>' + inputHtml + '</div>';
  }

  /**
   * An `<option>` list from `[value, label]` pairs, marking `sel`.
   *
   * Written once because the `selected` attribute is the part that gets
   * forgotten, and a select that never shows the current value looks like the
   * model lost it.
   */
  function options(pairs, sel) {
    return pairs
      .map(function (pair) {
        return (
          '<option value="' +
          esc(pair[0]) +
          '"' +
          (pair[0] === sel ? ' selected' : '') +
          '>' +
          esc(pair[1]) +
          '</option>'
        );
      })
      .join('');
  }

  // --- bands ----------------------------------------------------------------

  var BAND_TYPES = [
    { type: 'reportHeader', name: 'سربرگ گزارش' },
    { type: 'pageHeader', name: 'سرصفحه' },
    { type: 'detail', name: 'ردیف داده' },
    { type: 'pageFooter', name: 'پاصفحه' },
    { type: 'reportFooter', name: 'پابرگ گزارش' },
  ];

  /** The Persian name of a band type; an unlisted type keeps its own name. */
  function bandTypeName(type) {
    var match = BAND_TYPES.filter(function (b) {
      return b.type === type;
    })[0];
    return match ? match.name : type;
  }

  /** Bands that repeat per row, and so take a dataset. */
  function isRowBand(band) {
    return band.type === 'detail' || band.type === 'groupHeader' || band.type === 'groupFooter';
  }

  /** Which pages a header/footer repeats on. */
  var MASTER_OPTIONS = [
    ['all', 'همهٔ صفحات'],
    ['first', 'فقط صفحهٔ اول'],
    ['odd', 'صفحات فرد'],
    ['even', 'صفحات زوج'],
  ];

  /** The strip of band chips at the top of the inspector. */
  function bandBarHtml(t, activeBand) {
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

  /**
   * The active band's own settings.
   *
   * `deps` supplies what belongs to the document rather than to the band:
   * `activeBand` (the index), and `toDisplay`/`unitLabel` for the height, which
   * is stored in points and shown in the document's unit.
   *
   * The move/delete buttons disable themselves at the ends and at one band,
   * because the alternative is a button that looks available and does nothing.
   */
  function bandSettingsHtml(t, deps) {
    var i = deps.activeBand;
    var band = t.bands[i];
    var h = band.height && band.height.mode === 'fixed' ? band.height.value : '';
    var s =
      '<div class="sec head"><span class="el-ico">▤</span><div><b>' +
      esc(bandTypeName(band.type)) +
      '</b><small>باند · ' +
      band.elements.length +
      ' الِمان</small></div></div>';
    s += '<div class="sec"><div class="sec-title">تنظیمات باند</div>';
    s += field(
      'نوع',
      '<select data-band-type>' +
        options(
          BAND_TYPES.map(function (bt) {
            return [bt.type, bt.name];
          }),
          band.type,
        ) +
        '</select>',
    );
    s += field(
      'ارتفاع',
      '<input type="number" step="any" min="0" data-band-height title="ارتفاع باند (' +
        deps.unitLabel() +
        ')" value="' +
        (h === '' ? '' : deps.toDisplay(h)) +
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
      s += field(
        'تکرار روی',
        '<select title="این سرصفحه/پاصفحه روی کدام صفحات نمایش داده شود" data-band-master>' +
          options(MASTER_OPTIONS, band.master || 'all') +
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

  // --- the box panel --------------------------------------------------------

  /** `[key, glyph, title]` for the four edge toggles, in visual order. */
  var BOX_SIDES = [
    ['top', '↑', 'بالا'],
    ['right', '→', 'راست'],
    ['bottom', '↓', 'پایین'],
    ['left', '←', 'چپ'],
  ];

  var BORDER_STYLES = [
    ['solid', 'توپر'],
    ['dashed', 'خط‌چین'],
    ['dotted', 'نقطه‌چین'],
  ];

  /**
   * Fill, border, sides, radius, opacity and padding for one element.
   *
   * `toDisplay` converts the padding, which is the only value here kept in the
   * document's unit rather than in points — border width and corner radius stay
   * in points on purpose, the way every design tool keeps typographic measures
   * whatever the ruler says.
   */
  function boxHtml(el, toDisplay) {
    var f = M.borderFacts(el, toDisplay);
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
      '<select data-prop="boxBorderStyle">' + options(BORDER_STYLES, f.style) + '</select>',
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
    // 1.11 — held back from the 1.2 panel until the engine actually honoured it
    s += field(
      'بالشتک',
      '<input type="number" min="0" step="any" ' +
        'title="فاصلهٔ محتوا از لبهٔ جعبه — عرضِ شکستِ خط را هم کم می‌کند" ' +
        'data-prop="boxPadding" value="' +
        f.padding +
        '" placeholder="0">',
    );
    return s;
  }

  return {
    field: field,
    options: options,
    BAND_TYPES: BAND_TYPES,
    BOX_SIDES: BOX_SIDES,
    bandTypeName: bandTypeName,
    isRowBand: isRowBand,
    bandBarHtml: bandBarHtml,
    bandSettingsHtml: bandSettingsHtml,
    boxHtml: boxHtml,
  };
});
