/**
 * Unit tests for the designer's pure logic (designer-ux 4.1).
 *
 * Until now these formulas were reachable only through the jsdom smoke test,
 * which drives the whole application: it can tell you *that* a resize came out
 * wrong, never *which* term was wrong. Everything below asserts one behaviour.
 */
const U = require('./designer-util');

describe('snapValue', () => {
  it('snaps to the grid when no edge is near', () => {
    expect(U.snapValue(23, [], false)).toEqual({ v: 25, guide: null });
    expect(U.snapValue(22, [], false)).toEqual({ v: 20, guide: null });
  });

  it('prefers a nearby element edge, and reports it as a guide', () => {
    // 102 is 2 away from the edge at 100 and would otherwise grid-snap to 100
    // too — the difference is that an edge hit draws a guide line
    expect(U.snapValue(102, [100], false)).toEqual({ v: 100, guide: 100 });
    // 117 grid-snaps to 115, but the edge at 118 is within the threshold
    expect(U.snapValue(117, [118], false)).toEqual({ v: 118, guide: 118 });
  });

  it('ignores an edge further away than the threshold', () => {
    expect(U.snapValue(110, [118], false)).toEqual({ v: 110, guide: null });
  });

  it('takes the first matching edge when several are in range', () => {
    expect(U.snapValue(100, [101, 99], false).v).toBe(101);
  });

  it('honours a custom grid step (designer-ux 2.3)', () => {
    expect(U.snapValue(23, [], false, 10)).toEqual({ v: 20, guide: null });
    expect(U.snapValue(26, [], false, 10)).toEqual({ v: 30, guide: null });
    expect(U.snapValue(23, [], false, 1)).toEqual({ v: 23, guide: null });
  });

  it('treats a step of zero as "no grid" rather than dividing by it', () => {
    expect(U.snapValue(23.7, [], false, 0)).toEqual({ v: 23.7, guide: null });
  });

  it('falls back to the default step for a nonsense one', () => {
    // negative or non-numeric must not silently disable snapping
    expect(U.snapValue(23, [], false, -5)).toEqual({ v: 25, guide: null });
    expect(U.snapValue(23, [], false, undefined)).toEqual({ v: 25, guide: null });
  });

  it('still prefers an edge whatever the grid is', () => {
    expect(U.snapValue(102, [100], false, 50)).toEqual({ v: 100, guide: 100 });
  });

  it('passes the value straight through when snapping is held off', () => {
    expect(U.snapValue(23.4, [100], true)).toEqual({ v: 23.4, guide: null });
  });

  it('survives a missing edge list', () => {
    expect(U.snapValue(23, undefined, false).v).toBe(25);
  });
});

describe('display units', () => {
  it('round-trips within the precision each unit displays', () => {
    // Exact round-tripping is impossible by design: 100pt is 3.5277…cm, the
    // field shows 3.53, and writing that back gives 100.06pt. What must hold is
    // that the drift stays inside half a displayed step — under a tenth of a
    // point, which no printer or eye resolves. Anything larger would mean the
    // rounding is wrong, not merely lossy.
    for (const unit of ['pt', 'mm', 'cm']) {
      const step = 1 / Math.pow(10, U.unitOf(unit).decimals); // one displayed step
      const halfStepInPoints = U.fromDisplay(step, unit) / 2;
      const shown = U.toDisplay(100, unit);
      expect(Math.abs(U.fromDisplay(shown, unit) - 100)).toBeLessThanOrEqual(halfStepInPoints);
    }
  });

  it('is stable once a displayed value has been written back', () => {
    // the drift must not accumulate: a second edit of an unchanged field is a
    // no-op, or repeatedly opening the panel would creep a layout out of place
    for (const unit of ['pt', 'mm', 'cm']) {
      const once = U.fromDisplay(U.toDisplay(100, unit), unit);
      const twice = U.fromDisplay(U.toDisplay(once, unit), unit);
      expect(twice).toBeCloseTo(once, 9);
    }
  });

  it('converts to real millimetres and centimetres', () => {
    // 72pt is exactly one inch
    expect(U.toDisplay(72, 'mm')).toBeCloseTo(25.4, 1);
    expect(U.toDisplay(72, 'cm')).toBeCloseTo(2.54, 2);
  });

  it('rounds to what each unit can usefully show', () => {
    expect(U.toDisplay(100.4, 'pt')).toBe(100); // whole points
    expect(String(U.toDisplay(100, 'mm'))).toMatch(/^\d+(\.\d)?$/); // one decimal
    expect(String(U.toDisplay(100, 'cm'))).toMatch(/^\d+(\.\d{1,2})?$/); // two
  });

  it('treats an unknown or missing unit as points', () => {
    expect(U.toDisplay(42, undefined)).toBe(42);
    expect(U.toDisplay(42, 'furlong')).toBe(42);
    expect(U.unitLabel('furlong')).toBe('pt');
  });

  it('is a display concern only — points in, points out', () => {
    // typing "10" with cm selected must store 10cm worth of points
    expect(U.fromDisplay(10, 'cm')).toBeCloseTo((10 * 72) / 2.54, 3);
  });
});

describe('resolveBandHeight', () => {
  it('gives a fixed band its declared height however tall the content is', () => {
    expect(U.resolveBandHeight({ height: { mode: 'fixed', value: 60 } }, 500)).toBe(60);
    expect(U.resolveBandHeight({ height: { mode: 'fixed', value: 60 } }, 0)).toBe(60);
  });

  it('grows an auto band to its content', () => {
    expect(U.resolveBandHeight({ height: { mode: 'auto' } }, 123)).toBe(123);
  });

  it('honours min and max on an auto band', () => {
    expect(U.resolveBandHeight({ height: { mode: 'auto', min: 50 } }, 10)).toBe(50);
    expect(U.resolveBandHeight({ height: { mode: 'auto', max: 80 } }, 500)).toBe(80);
  });

  it('defaults to auto when a band declares no height', () => {
    expect(U.resolveBandHeight({}, 42)).toBe(42);
  });
});

describe('isPageWideBand', () => {
  it('is true only for the bands that span the page by contract', () => {
    expect(U.isPageWideBand({ type: 'background' })).toBe(true);
    expect(U.isPageWideBand({ type: 'watermark' })).toBe(true);
    expect(U.isPageWideBand({ type: 'detail' })).toBe(false);
    expect(U.isPageWideBand(undefined)).toBe(false);
  });
});

describe('resizeBounds', () => {
  const start = { x: 100, y: 100, width: 100, height: 50 };

  it('grows width and height from the south-east grip, leaving the origin', () => {
    const { bounds } = U.resizeBounds(start, 'se', 20, 10);
    expect(bounds).toEqual({ x: 100, y: 100, width: 120, height: 60 });
  });

  it('drags the origin from the north-west grip instead of moving the box', () => {
    const { bounds } = U.resizeBounds(start, 'nw', 20, 10);
    expect(bounds).toEqual({ x: 120, y: 110, width: 80, height: 40 });
  });

  it('drives one axis only from an edge grip', () => {
    expect(U.resizeBounds(start, 'e', 30, 30).bounds).toEqual({
      x: 100,
      y: 100,
      width: 130,
      height: 50,
    });
    expect(U.resizeBounds(start, 'n', 30, 20).bounds).toEqual({
      x: 100,
      y: 120,
      width: 100,
      height: 30,
    });
  });

  it('never lets an edge cross its opposite', () => {
    const { bounds } = U.resizeBounds(start, 'e', -500, 0);
    expect(bounds.width).toBe(U.MIN_SIZE);
    expect(bounds.x).toBe(100);
    // and from the other side, the origin stops rather than overshooting
    const nw = U.resizeBounds(start, 'nw', 500, 500).bounds;
    expect(nw.width).toBe(U.MIN_SIZE);
    expect(nw.x).toBe(100 + 100 - U.MIN_SIZE);
  });

  it('keeps the aspect ratio when asked, following the dominant axis', () => {
    // 100×50 is 2:1
    const { bounds } = U.resizeBounds(start, 'se', 60, 0, { keepRatio: true });
    expect(bounds.width / bounds.height).toBeCloseTo(2, 5);
    expect(bounds.width).toBe(160);
  });

  it('derives the other axis for an edge grip under keepRatio', () => {
    const { bounds } = U.resizeBounds(start, 'e', 100, 0, { keepRatio: true });
    expect(bounds.width).toBe(200);
    expect(bounds.height).toBeCloseTo(100, 5);
  });

  it('re-anchors to the fixed edges when keepRatio moves the origin', () => {
    const { bounds } = U.resizeBounds(start, 'nw', -100, 0, { keepRatio: true });
    // the south-east corner must not have moved
    expect(bounds.x + bounds.width).toBeCloseTo(200, 5);
    expect(bounds.y + bounds.height).toBeCloseTo(150, 5);
  });

  it('routes each axis through its own snap and reports the guides', () => {
    const { bounds, guideX, guideY } = U.resizeBounds(start, 'se', 3, 3, {
      snapX: (v) => ({ v: 210, guide: 210 }),
      snapY: (v) => ({ v: 160, guide: null }),
    });
    expect(bounds.width).toBe(110);
    expect(bounds.height).toBe(60);
    expect(guideX).toBe(210);
    expect(guideY).toBeNull();
  });

  it('falls back to the south-east grip for an unknown direction', () => {
    expect(U.resizeBounds(start, 'nonsense', 10, 10).bounds).toEqual(
      U.resizeBounds(start, 'se', 10, 10).bounds,
    );
  });
});

describe('fitImageBox', () => {
  it('caps a landscape picture at the default width', () => {
    expect(U.fitImageBox(800, 400)).toEqual({ width: 180, height: 90 });
  });

  it('caps a portrait picture at the default height instead', () => {
    const box = U.fitImageBox(400, 1200);
    expect(box.height).toBe(240);
    expect(box.width).toBe(80);
    expect(box.width / box.height).toBeCloseTo(400 / 1200, 2);
  });

  it('keeps a square square', () => {
    expect(U.fitImageBox(500, 500)).toEqual({ width: 180, height: 180 });
  });

  it('falls back to a plain rectangle when the size could not be read', () => {
    // jsdom has no image decoder, so this is the normal path in tests
    expect(U.fitImageBox(0, 0)).toEqual({ width: 180, height: 120 });
    expect(U.fitImageBox(NaN, NaN)).toEqual({ width: 180, height: 120 });
  });
});

describe('fitZoom', () => {
  const A4 = { width: 595, height: 842 };
  const RECEIPT = { width: 226, height: 430 };

  it('fits by the tighter of the two axes', () => {
    // a wide viewport still cannot make an A4 taller than it is
    const z = U.fitZoom(A4, 2000, 700, 90);
    expect(z).toBeCloseTo((700 - 90) / 842, 1);
    expect(z * A4.height).toBeLessThanOrEqual(700 - 90);
  });

  it('scales a small page UP, which the old fixed 85% never did', () => {
    // the bug the user saw: an 80mm receipt sat smaller than the read-only
    // preview beside it, because 85% was applied to everything
    const z = U.fitZoom(RECEIPT, 900, 800, 90);
    expect(z).toBeGreaterThan(1);
    expect(z).toBeGreaterThan(U.fitZoom(A4, 900, 800, 90));
  });

  it('never exceeds the range the zoom buttons allow', () => {
    expect(U.fitZoom({ width: 10, height: 10 }, 4000, 4000, 90)).toBe(2);
    expect(U.fitZoom({ width: 9000, height: 9000 }, 500, 500, 90)).toBe(0.4);
  });

  it('rounds to 5% so the readout stays legible', () => {
    const z = U.fitZoom(RECEIPT, 823, 777, 90);
    expect(Math.round(z * 1000) % 50).toBe(0);
  });

  it('returns null rather than a tiny zoom when nothing has been laid out', () => {
    // jsdom reports 0 for every client dimension; collapsing to the 40% minimum
    // would make "unmeasured" look exactly like "genuinely enormous"
    expect(U.fitZoom(A4, 0, 0, 90)).toBeNull();
    expect(U.fitZoom(A4, 80, 80, 90)).toBeNull();
    expect(U.fitZoom(null, 900, 900, 90)).toBeNull();
    expect(U.fitZoom({ width: 0, height: 0 }, 900, 900, 90)).toBeNull();
  });
});

describe('rulerStep', () => {
  it('picks a round number in the display unit, not in points', () => {
    // 10mm is a step a person writes; 28.35pt is not
    const mm = U.rulerStep(1, 'mm');
    expect([1, 2, 5, 10, 20, 50, 100]).toContain(mm.unit);
    const cm = U.rulerStep(1, 'cm');
    expect([1, 2, 5, 10, 20, 50].map((n) => n / 10).concat([1, 2, 5, 10])).toContain(cm.unit);
  });

  it('only ever offers 1, 2 or 5 times a power of ten', () => {
    for (const unit of ['pt', 'mm', 'cm']) {
      for (const zoom of [0.1, 0.25, 0.5, 0.85, 1, 2, 4]) {
        const { unit: step } = U.rulerStep(zoom, unit);
        const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
        expect([1, 2, 5]).toContain(Math.round(mantissa));
      }
    }
  });

  it('always leaves room for the labels', () => {
    const gap = 56;
    for (const unit of ['pt', 'mm', 'cm']) {
      for (const zoom of [0.1, 0.5, 1, 3]) {
        expect(U.rulerStep(zoom, unit, gap).pt * zoom).toBeGreaterThanOrEqual(gap);
      }
    }
  });

  it('thins out as you zoom away, never the other way round', () => {
    const far = U.rulerStep(0.25, 'mm').pt;
    const near = U.rulerStep(2, 'mm').pt;
    expect(far).toBeGreaterThan(near);
  });
});

describe('rulerTicks', () => {
  it('counts from the origin, so zero is the content edge', () => {
    const ticks = U.rulerTicks(600, 1, 'pt', 30);
    const zero = ticks.find((t) => t.label === '0');
    expect(zero).toBeDefined();
    expect(zero.pt).toBe(30);
  });

  it('still covers the paper before the origin', () => {
    const ticks = U.rulerTicks(600, 1, 'pt', 200);
    // the margin area is part of the sheet and gets negative numbers
    expect(ticks.some((t) => t.pt < 200)).toBe(true);
    expect(ticks.some((t) => t.label.startsWith('-'))).toBe(true);
  });

  it('stays inside the paper', () => {
    const ticks = U.rulerTicks(595, 1, 'pt', 30);
    for (const t of ticks) {
      expect(t.pt).toBeGreaterThanOrEqual(0);
      expect(t.pt).toBeLessThanOrEqual(595.001);
    }
  });

  it('is evenly spaced', () => {
    const ticks = U.rulerTicks(600, 1, 'mm', 0);
    const gaps = ticks.slice(1).map((t, i) => t.pt - ticks[i].pt);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);
  });

  it('labels in whole numbers where the step allows it', () => {
    // a 10mm step must not print "10.0"
    const ticks = U.rulerTicks(600, 1, 'mm', 0);
    for (const t of ticks) expect(t.label).not.toMatch(/\.\d*0$/);
  });

  it('produces something at every zoom without running away', () => {
    for (const zoom of [0.1, 0.5, 1, 4]) {
      const ticks = U.rulerTicks(842, zoom, 'mm', 30);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length).toBeLessThan(200); // a smear of labels helps nobody
    }
  });
});

describe('dataPaths', () => {
  it('walks nested objects into dotted paths', () => {
    expect(U.dataPaths({ customer: { name: 'x', city: 'y' } })).toEqual([
      'customer.name',
      'customer.city',
    ]);
  });

  it('offers the first row of an array plus its length', () => {
    expect(U.dataPaths({ items: [{ name: 'a', qty: 1 }] })).toEqual([
      'items[0].name',
      'items[0].qty',
      'len(items)',
    ]);
  });

  it('offers only the length for an array of primitives or an empty one', () => {
    expect(U.dataPaths({ tags: ['a', 'b'] })).toEqual(['len(tags)']);
    expect(U.dataPaths({ tags: [] })).toEqual(['len(tags)']);
  });

  it('handles null, undefined and an empty object without throwing', () => {
    expect(U.dataPaths(null)).toEqual([]);
    expect(U.dataPaths({})).toEqual([]);
    expect(U.dataPaths({ a: null })).toEqual(['a']);
  });
});
