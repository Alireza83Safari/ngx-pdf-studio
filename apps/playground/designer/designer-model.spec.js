/**
 * The designer's model reading, asserted directly.
 *
 * All of this used to live inside `designer.js`'s IIFE, where the only thing
 * that could reach it was a jsdom smoke test — and a smoke test that clicks
 * through the UI cannot separate a wrong rule from wrong wiring. These are the
 * rules: which border sides `all` means, what an element is called when nobody
 * named it, where a new element lands when the band is full.
 */
const M = require('./designer-model');

describe('esc', () => {
  it('escapes everything either of the two old copies did', () => {
    // `designer.js` had two: one did & " <, the other & < >. Whichever you
    // reached for, something went through — and which one you got depended on
    // where in the file you were.
    expect(M.esc('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  });

  it('escapes the ampersand before the entities it introduces', () => {
    // `&` → `&amp;` must not then re-escape its own `&`
    expect(M.esc('&lt;')).toBe('&amp;lt;');
  });

  it('survives values that are not strings', () => {
    expect(M.esc(null)).toBe('null');
    expect(M.esc(42)).toBe('42');
  });
});

describe('colour round-trip', () => {
  it('maps hex to the model shape and back', () => {
    expect(M.hexToRgb('#3b76f6')).toEqual({ space: 'rgb', r: 59, g: 118, b: 246 });
    expect(M.rgbToHex(M.hexToRgb('#3b76f6'))).toBe('#3b76f6');
  });

  it('pads a component that needs a leading zero', () => {
    // the classic bug: #0a0b0c coming back as #a0b0c and shifting every channel
    expect(M.rgbToHex({ space: 'rgb', r: 10, g: 11, b: 12 })).toBe('#0a0b0c');
  });

  it('accepts hex with or without the hash, in either case', () => {
    expect(M.hexToRgb('3B76F6')).toEqual(M.hexToRgb('#3b76f6'));
  });

  it('falls back rather than throwing on nonsense', () => {
    // these run on every keystroke in a colour field, mid-edit
    expect(M.hexToRgb('#xyz')).toEqual({ space: 'rgb', r: 0, g: 0, b: 0 });
    expect(M.rgbToHex(null)).toBe('#000000');
    expect(M.rgbToHex({ space: 'cmyk', c: 1 })).toBe('#000000');
  });
});

describe('layerLabel', () => {
  it('prefers the name the author gave it', () => {
    expect(M.layerLabel({ type: 'staticText', name: 'سربرگ', text: 'x' })).toBe('سربرگ');
  });

  it('falls back to something descriptive rather than repeating the type', () => {
    expect(M.layerLabel({ type: 'staticText', text: 'فاکتور' })).toBe('فاکتور');
    expect(M.layerLabel({ type: 'dataField', value: { source: 'customer.name' } })).toBe(
      'customer.name',
    );
    expect(M.layerLabel({ type: 'container', children: [{}, {}] })).toContain('2');
  });

  it('does not crash on a container with no children array', () => {
    expect(() => M.layerLabel({ type: 'container' })).not.toThrow();
  });

  it('names an unknown type after itself instead of showing nothing', () => {
    expect(M.layerLabel({ type: 'somethingNew' })).toBe('somethingNew');
  });
});

describe('labeled field children', () => {
  const el = {
    type: 'container',
    children: [
      { type: 'rectangle', id: 'bg' },
      { type: 'staticText', id: 'cap' },
      { type: 'dataField', id: 'val' },
      { type: 'staticText', id: 'second' },
    ],
  };

  it('takes the first child of each kind, not any child', () => {
    expect(M.labeledLabel(el).id).toBe('cap');
    expect(M.labeledValue(el).id).toBe('val');
  });

  it('returns undefined rather than throwing when a group is not a labeled field', () => {
    expect(M.labeledLabel({ type: 'container' })).toBeUndefined();
    expect(M.labeledValue({ type: 'container', children: [] })).toBeUndefined();
  });
});

describe('borderFacts', () => {
  it('reads `all` as all four sides on', () => {
    const f = M.borderFacts({ box: { border: { all: { width: 2, color: null } } } });
    expect(f.on).toEqual({ top: true, right: true, bottom: true, left: true });
    expect(f.width).toBe(2);
  });

  it('reads named sides as exactly those sides', () => {
    const f = M.borderFacts({
      box: { border: { top: { width: 1 }, bottom: { width: 1 } } },
    });
    expect(f.on).toEqual({ top: true, right: false, bottom: true, left: false });
  });

  it('defaults to all four when there is no border yet', () => {
    // width is the on/off switch, so typing one alone has to produce a box —
    // otherwise the width has nowhere to live and snaps back to 0 on re-render
    const f = M.borderFacts({});
    expect(f.on).toEqual({ top: true, right: true, bottom: true, left: true });
    expect(f.width).toBe(0);
  });

  it('treats a missing opacity as fully opaque, not as zero', () => {
    expect(M.borderFacts({}).opacityPct).toBe(100);
    expect(M.borderFacts({ box: { opacity: 0.5 } }).opacityPct).toBe(50);
    // 0 is a real value and must survive the null check
    expect(M.borderFacts({ box: { opacity: 0 } }).opacityPct).toBe(0);
  });

  it('distinguishes "no radius" from "radius zero"', () => {
    // an empty field and a typed 0 mean different things to the input
    expect(M.borderFacts({}).radius).toBe('');
    expect(M.borderFacts({ box: { border: { radius: 0 } } }).radius).toBe(0);
  });

  it('converts padding through the caller-supplied unit conversion', () => {
    const mm = (pt) => pt / 2.834645669291339;
    const f = M.borderFacts({ box: { padding: { top: 28.35 } } }, mm);
    expect(f.padding).toBeCloseTo(10, 2);
  });
});

describe('nextSpot', () => {
  const box = (x, y, width, height) => ({ bounds: { x, y, width, height } });

  it('puts the first element at the origin', () => {
    expect(M.nextSpot([], 200, 24)).toEqual({ x: 0, y: 0 });
  });

  it('steps down past something already there', () => {
    const spot = M.nextSpot([box(0, 0, 200, 24)], 200, 24);
    expect(spot.x).toBe(0);
    expect(spot.y).toBeGreaterThanOrEqual(24);
  });

  it('ignores an element that does not overlap horizontally', () => {
    // scanning past a box in a different column would leave a hole for no reason
    expect(M.nextSpot([box(400, 0, 100, 24)], 200, 24)).toEqual({ x: 0, y: 0 });
  });

  it('gives up rather than scanning forever when nothing is free', () => {
    // one very tall element covers every row the scan would try
    const spot = M.nextSpot([box(0, 0, 500, 100000)], 200, 24);
    expect(Number.isFinite(spot.y)).toBe(true);
    expect(spot.y).toBeLessThanOrEqual(500 * 8);
  });
});

describe('displayTemplate', () => {
  const template = () => ({
    bands: [
      {
        elements: [
          {
            id: 'a',
            type: 'dataField',
            value: { source: 'customer.name' },
            format: { kind: 'money' },
          },
          { id: 'b', type: 'staticText', text: 'ثابت' },
        ],
      },
    ],
  });

  it('hands the template back untouched when values are shown', () => {
    const t = template();
    expect(M.displayTemplate(t, true)).toBe(t);
  });

  it('rewrites bound fields into the text that names them', () => {
    // the engine renders both modes, so the canvas cannot drift from the paper
    const out = M.displayTemplate(template(), false);
    const field = out.bands[0].elements[0];
    expect(field.type).toBe('staticText');
    expect(field.text).toBe('{customer.name}');
    expect(field.format).toBeUndefined();
  });

  it('does not mutate the template it was given', () => {
    const t = template();
    M.displayTemplate(t, false);
    expect(t.bands[0].elements[0].type).toBe('dataField');
  });

  it('leaves static text alone', () => {
    const out = M.displayTemplate(template(), false);
    expect(out.bands[0].elements[1].text).toBe('ثابت');
  });
});

describe('typeIcon', () => {
  it('draws a known type at the size asked for', () => {
    const svg = M.typeIcon('staticText', 13);
    expect(svg).toContain('width="13"');
    expect(svg).toContain('<path');
  });

  it('gives an unmapped type a box rather than an empty <svg>', () => {
    // new element types land in the toolbox before they get an icon
    expect(M.typeIcon('somethingNew', 13)).toContain('<rect');
  });
});
