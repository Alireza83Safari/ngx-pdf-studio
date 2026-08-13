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

describe('appearanceHtml', () => {
  const deps = { families: ['Vazirmatn', 'IRANSans'], defaultFamily: 'Vazirmatn' };
  const text = (typography) => ({ type: 'staticText', typography });

  it('gives a line its stroke colour and nothing else', () => {
    // a line paints from `stroke`, so typography there would be decoration
    const html = I.appearanceHtml({ type: 'line' }, deps);
    expect(has(html, 'stroke')).toBe(true);
    expect(has(html, 'fontSize')).toBe(false);
  });

  it('gives every textual type the full panel', () => {
    for (const type of I.TEXTUAL) {
      const html = I.appearanceHtml({ type }, deps);
      for (const prop of [
        'fontFamily',
        'fontSize',
        'color',
        'bold',
        'italic',
        'underline',
        'strike',
        'verticalAlign',
        'align',
        'letterSpacing',
        'lineHeight',
      ]) {
        expect([type, prop, has(html, prop)]).toEqual([type, prop, true]);
      }
    }
  });

  it('gives a type with no typography no panel at all', () => {
    // an empty string is what the caller checks to decide whether to draw the
    // section heading — returning a wrapper would print an empty box
    expect(I.appearanceHtml({ type: 'table' }, deps)).toBe('');
    expect(I.appearanceHtml({ type: 'qrcode' }, deps)).toBe('');
  });

  it('offers every embedded family and preselects the element’s own', () => {
    const html = I.appearanceHtml(text({ fontFamily: 'IRANSans' }), deps);
    expect(html).toContain('<option value="Vazirmatn"');
    expect(html).toContain('<option value="IRANSans" selected>');
  });

  it('falls back to the bundled family when the element names none', () => {
    const html = I.appearanceHtml(text({}), deps);
    expect(html).toContain('<option value="Vazirmatn" selected>');
  });

  describe('the style toggles', () => {
    // Four independent switches sharing one row. Each reads a different model
    // field, and `underline`/`strike` read the *same* one — which is exactly
    // where a copy-paste bug would land.
    it('checks bold only for a bold element', () => {
      expect(control(I.appearanceHtml(text({ fontWeight: 'bold' }), deps), 'bold')).toContain(
        'checked',
      );
      expect(control(I.appearanceHtml(text({}), deps), 'bold')).not.toContain('checked');
    });

    it('checks italic only for an italic element', () => {
      expect(control(I.appearanceHtml(text({ fontStyle: 'italic' }), deps), 'italic')).toContain(
        'checked',
      );
      expect(control(I.appearanceHtml(text({}), deps), 'italic')).not.toContain('checked');
    });

    it('tells underline and strike-through apart, though both read `decoration`', () => {
      const under = I.appearanceHtml(text({ decoration: 'underline' }), deps);
      expect(control(under, 'underline')).toContain('checked');
      expect(control(under, 'strike')).not.toContain('checked');

      const struck = I.appearanceHtml(text({ decoration: 'line-through' }), deps);
      expect(control(struck, 'strike')).toContain('checked');
      expect(control(struck, 'underline')).not.toContain('checked');
    });
  });

  it('defaults alignment to start and vertical alignment to top', () => {
    const html = I.appearanceHtml(text({}), deps);
    expect(html).toContain('<option value="start" selected>');
    expect(html).toContain('<option value="top" selected>');
  });

  it('preselects the alignment the element has', () => {
    const html = I.appearanceHtml(text({ align: 'center', verticalAlign: 'middle' }), deps);
    expect(html).toContain('<option value="center" selected>');
    expect(html).toContain('<option value="middle" selected>');
    expect(html).not.toContain('<option value="start" selected>');
  });

  it('explains kashida justification only when justify is chosen', () => {
    // the hint is about Persian shaping and is noise on every other setting
    expect(I.appearanceHtml(text({ align: 'justify' }), deps)).toContain('کشیده');
    expect(I.appearanceHtml(text({ align: 'center' }), deps)).not.toContain('tinyhint');
  });

  it('leaves spacing fields blank when unset, so the placeholder shows the default', () => {
    const html = I.appearanceHtml(text({}), deps);
    expect(control(html, 'letterSpacing')).toContain('value=""');
    expect(control(html, 'lineHeight')).toContain('value=""');
    expect(control(html, 'lineHeight')).toContain('placeholder="1.2"');
  });

  it('shows a spacing of zero as zero, not as blank', () => {
    // 0 is a real setting and has to survive the null check
    expect(control(I.appearanceHtml(text({ letterSpacing: 0 }), deps), 'letterSpacing')).toContain(
      'value="0"',
    );
  });

  it('escapes a font family rather than letting it close the attribute', () => {
    const html = I.appearanceHtml(text({}), {
      families: ['a" onx="1'],
      defaultFamily: 'Vazirmatn',
    });
    expect(html).toContain('value="a&quot; onx=&quot;1"');
    expect(html).not.toContain('value="a" onx="1"');
  });
});

describe('conditionsHtml', () => {
  it('always offers all three controls, whatever the element', () => {
    const html = I.conditionsHtml({ type: 'staticText' });
    expect(has(html, 'viswhen')).toBe(true);
    expect(has(html, 'condwhen')).toBe(true);
    expect(has(html, 'condcolor')).toBe(true);
  });

  it('shows the expressions the element carries', () => {
    const html = I.conditionsHtml({
      visibleWhen: { source: 'total > 0' },
      conditionalStyles: [
        {
          when: { source: 'amount < 0' },
          typography: { color: { space: 'rgb', r: 1, g: 2, b: 3 } },
        },
      ],
    });
    expect(control(html, 'viswhen')).toContain('value="total &gt; 0"');
    expect(control(html, 'condwhen')).toContain('value="amount &lt; 0"');
    expect(control(html, 'condcolor')).toContain('value="#010203"');
  });

  it('leaves both expressions empty on an element with no conditions', () => {
    const html = I.conditionsHtml({ type: 'staticText' });
    expect(control(html, 'viswhen')).toContain('value=""');
    expect(control(html, 'condwhen')).toContain('value=""');
  });

  it('reads only the first style rule, which is all the UI edits', () => {
    // the engine takes a list; this panel is documented as one rule, and
    // silently showing the second would misreport what editing overwrites
    const html = I.conditionsHtml({
      conditionalStyles: [{ when: { source: 'first' } }, { when: { source: 'second' } }],
    });
    expect(control(html, 'condwhen')).toContain('value="first"');
    expect(html).not.toContain('second');
  });

  it('escapes an expression instead of letting it break out of the attribute', () => {
    // conditions arrive from imported templates, so they are untrusted
    const html = I.conditionsHtml({ visibleWhen: { source: 'a" onx="1' } });
    expect(html).toContain('value="a&quot; onx=&quot;1"');
    expect(html).not.toContain('value="a" onx="1"');
  });
});
