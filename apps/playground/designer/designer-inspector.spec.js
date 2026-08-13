/**
 * The inspector panels that are a function of the model alone.
 *
 * `model-coverage.spec.js` already fails the build when a style property has no
 * control here, so every field below is guaranteed to *exist*. Nothing checked
 * it was built **right** — and the two failures look identical to a grep:
 *
 *  - a checkbox rendered without `checked`, so a border that is on reads as off
 *    and the next click turns it off again;
 *  - a `<select>` with no `selected` option, so it shows its first entry and the
 *    model looks like it lost the value;
 *  - a number field showing points in a millimetre document.
 *
 * The smoke test drives 10 of the inspector's 44 controls and none of the box
 * panel's nine, which is why this exists before any more of `renderInspector`
 * moves.
 */
const I = require('./designer-inspector');

/** The attribute value of `data-prop="x"` — i.e. is the control there at all. */
const has = (html, prop) => html.includes(`data-prop="${prop}"`);

/** The tag for one `data-prop`, so its attributes can be asserted. */
function control(html, prop) {
  const at = html.indexOf(`data-prop="${prop}"`);
  if (at < 0) throw new Error(`no control for ${prop}`);
  const open = html.lastIndexOf('<', at);
  return html.slice(open, html.indexOf('>', at) + 1);
}

describe('options', () => {
  it('marks the selected entry and only that one', () => {
    const html = I.options(
      [
        ['a', 'A'],
        ['b', 'B'],
      ],
      'b',
    );
    expect(html).toContain('<option value="b" selected>B</option>');
    expect(html.match(/selected/g)).toHaveLength(1);
  });

  it('marks nothing when the current value is not in the list', () => {
    // better a select showing its first entry than one claiming a value the
    // model does not have
    expect(I.options([['a', 'A']], 'zzz')).not.toContain('selected');
  });

  it('escapes both halves', () => {
    expect(I.options([['a"b', '<x>']], null)).toBe('<option value="a&quot;b">&lt;x&gt;</option>');
  });
});

describe('bandTypeName', () => {
  it('names the five band types', () => {
    expect(I.bandTypeName('detail')).toBe('ردیف داده');
    expect(I.bandTypeName('pageHeader')).toBe('سرصفحه');
  });

  it('falls back to the raw type rather than showing nothing', () => {
    expect(I.bandTypeName('groupHeader')).toBe('groupHeader');
  });
});

describe('isRowBand', () => {
  it('is true for the bands that repeat per row', () => {
    expect(I.isRowBand({ type: 'detail' })).toBe(true);
    expect(I.isRowBand({ type: 'groupHeader' })).toBe(true);
    expect(I.isRowBand({ type: 'groupFooter' })).toBe(true);
  });

  it('is false for the ones that do not take a dataset', () => {
    expect(I.isRowBand({ type: 'reportHeader' })).toBe(false);
    expect(I.isRowBand({ type: 'pageFooter' })).toBe(false);
  });
});

describe('bandBarHtml', () => {
  const t = {
    bands: [
      { id: 'a', type: 'reportHeader', elements: [{}, {}] },
      { id: 'b', type: 'detail', elements: [] },
    ],
  };

  it('marks the active chip and no other', () => {
    const html = I.bandBarHtml(t, 1);
    expect(html.match(/band-chip active/g)).toHaveLength(1);
    expect(html.indexOf('band-chip active')).toBeGreaterThan(html.indexOf('data-band="0"'));
  });

  it('shows each band’s element count, including zero', () => {
    const html = I.bandBarHtml(t, 0);
    expect(html).toContain('<small>2</small>');
    expect(html).toContain('<small>0</small>');
  });

  it('offers a way to add a band', () => {
    expect(I.bandBarHtml(t, 0)).toContain('data-band-add');
  });
});

describe('bandSettingsHtml', () => {
  const deps = (over) =>
    Object.assign({ activeBand: 0, toDisplay: (pt) => pt, unitLabel: () => 'pt' }, over);
  const template = (bands) => ({ bands });

  it('preselects the band’s own type', () => {
    const html = I.bandSettingsHtml(
      template([{ id: 'a', type: 'detail', elements: [], height: { mode: 'fixed', value: 20 } }]),
      deps(),
    );
    expect(html).toContain('<option value="detail" selected>');
  });

  it('shows the height through the document’s unit, not in raw points', () => {
    const html = I.bandSettingsHtml(
      template([
        { id: 'a', type: 'detail', elements: [], height: { mode: 'fixed', value: 28.35 } },
      ]),
      deps({ toDisplay: (pt) => Math.round(pt / 2.834645669291339), unitLabel: () => 'mm' }),
    );
    expect(html).toContain('value="10"');
    expect(html).toContain('(mm)');
  });

  it('leaves the height blank for an auto band rather than inventing a number', () => {
    const html = I.bandSettingsHtml(
      template([{ id: 'a', type: 'detail', elements: [], height: { mode: 'auto' } }]),
      deps(),
    );
    expect(html).toContain('data-band-height title="ارتفاع باند (pt)" value=""');
  });

  it('offers a dataset only on bands that repeat per row', () => {
    const row = I.bandSettingsHtml(
      template([{ id: 'a', type: 'detail', elements: [], height: { mode: 'auto' } }]),
      deps(),
    );
    const notRow = I.bandSettingsHtml(
      template([{ id: 'a', type: 'reportHeader', elements: [], height: { mode: 'auto' } }]),
      deps(),
    );
    expect(row).toContain('data-band-dataset');
    expect(notRow).not.toContain('data-band-dataset');
  });

  it('offers the repeat-on choice only for page headers and footers', () => {
    const header = I.bandSettingsHtml(
      template([{ id: 'a', type: 'pageHeader', elements: [], height: { mode: 'auto' } }]),
      deps(),
    );
    const detail = I.bandSettingsHtml(
      template([{ id: 'a', type: 'detail', elements: [], height: { mode: 'auto' } }]),
      deps(),
    );
    expect(header).toContain('data-band-master');
    expect(header).toContain('<option value="all" selected>');
    expect(detail).not.toContain('data-band-master');
  });

  describe('the move and delete buttons', () => {
    const three = template([
      { id: 'a', type: 'reportHeader', elements: [], height: { mode: 'auto' } },
      { id: 'b', type: 'detail', elements: [], height: { mode: 'auto' } },
      { id: 'c', type: 'pageFooter', elements: [], height: { mode: 'auto' } },
    ]);

    // A button that looks available and does nothing is worse than a disabled
    // one: the user concludes the feature is broken rather than unavailable.
    it('disables "up" on the first band and "down" on the last', () => {
      const first = I.bandSettingsHtml(three, deps({ activeBand: 0 }));
      expect(first).toContain('data-band-up title="جابه‌جایی به بالا" disabled');
      expect(first).not.toContain('data-band-down title="جابه‌جایی به پایین" disabled');

      const last = I.bandSettingsHtml(three, deps({ activeBand: 2 }));
      expect(last).toContain('data-band-down title="جابه‌جایی به پایین" disabled');
      expect(last).not.toContain('data-band-up title="جابه‌جایی به بالا" disabled');
    });

    it('enables both in the middle', () => {
      const mid = I.bandSettingsHtml(three, deps({ activeBand: 1 }));
      expect(mid).not.toContain('data-band-up title="جابه‌جایی به بالا" disabled');
      expect(mid).not.toContain('data-band-down title="جابه‌جایی به پایین" disabled');
    });

    it('refuses to delete the only band', () => {
      // a document with no bands has nowhere to put anything
      const one = I.bandSettingsHtml(
        template([{ id: 'a', type: 'detail', elements: [], height: { mode: 'auto' } }]),
        deps(),
      );
      expect(one).toContain('data-band-del title="حذف این باند" disabled');
      expect(I.bandSettingsHtml(three, deps({ activeBand: 1 }))).not.toContain(
        'data-band-del title="حذف این باند" disabled',
      );
    });
  });

  it('escapes a dataset name rather than letting it close the attribute', () => {
    // A dataset name arrives from an imported template, so it is untrusted.
    // What matters is not that `onx=` is absent — it is fine inside a value —
    // but that the quotes around it are escaped, so the value cannot end early
    // and the text that follows can never become an attribute.
    const html = I.bandSettingsHtml(
      template([
        { id: 'a', type: 'detail', elements: [], height: { mode: 'auto' }, dataset: 'a" onx="1' },
      ]),
      deps(),
    );
    expect(html).toContain('value="a&quot; onx=&quot;1"');
    expect(html).not.toContain('value="a" onx="1"');
  });
});

describe('boxHtml', () => {
  const pt = (v) => v;

  it('renders every control the box panel owns', () => {
    const html = I.boxHtml({}, pt);
    for (const prop of [
      'boxFillOn',
      'boxFill',
      'boxBorderColor',
      'boxBorderWidth',
      'boxBorderStyle',
      'boxRadius',
      'boxOpacity',
      'boxPadding',
    ]) {
      expect(has(html, prop)).toBe(true);
    }
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(has(html, `boxSide-${side}`)).toBe(true);
    }
  });

  it('checks the fill box only when there is a fill', () => {
    expect(control(I.boxHtml({}, pt), 'boxFillOn')).not.toContain('checked');
    expect(
      control(
        I.boxHtml({ box: { fill: { color: { space: 'rgb', r: 0, g: 0, b: 0 } } } }, pt),
        'boxFillOn',
      ),
    ).toContain('checked');
  });

  it('checks the edges that are actually on', () => {
    // `all` means all four; named sides mean exactly those
    const all = I.boxHtml({ box: { border: { all: { width: 1 } } } }, pt);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(control(all, `boxSide-${side}`)).toContain('checked');
    }

    const some = I.boxHtml({ box: { border: { top: { width: 1 }, left: { width: 1 } } } }, pt);
    expect(control(some, 'boxSide-top')).toContain('checked');
    expect(control(some, 'boxSide-left')).toContain('checked');
    expect(control(some, 'boxSide-right')).not.toContain('checked');
    expect(control(some, 'boxSide-bottom')).not.toContain('checked');
  });

  it('preselects the border style the element has', () => {
    const html = I.boxHtml({ box: { border: { all: { width: 1, style: 'dashed' } } } }, pt);
    expect(html).toContain('<option value="dashed" selected>');
    expect(html.match(/selected/g)).toHaveLength(1);
  });

  it('defaults an element with no border to solid, not to nothing', () => {
    expect(I.boxHtml({}, pt)).toContain('<option value="solid" selected>');
  });

  it('shows a full-opacity element as 100, not as blank', () => {
    expect(control(I.boxHtml({}, pt), 'boxOpacity')).toContain('value="100"');
  });

  it('shows padding through the document’s unit', () => {
    const mm = (v) => Math.round(v / 2.834645669291339);
    expect(control(I.boxHtml({ box: { padding: { top: 28.35 } } }, mm), 'boxPadding')).toContain(
      'value="10"',
    );
  });

  it('leaves radius and padding blank when unset, so the placeholder shows', () => {
    const html = I.boxHtml({}, pt);
    expect(control(html, 'boxRadius')).toContain('value=""');
    expect(control(html, 'boxPadding')).toContain('value=""');
  });
});
