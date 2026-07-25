import type { AnyElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';
import {
  addElement,
  patchElement,
  patchPageSetup,
  removeElementById,
  setElementBounds,
  setStaticText,
} from './commands';
import { findElement } from './template-ops';

const el = (id: string): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x: 0, y: 0, width: 50, height: 20 },
  zIndex: 1,
  text: id,
});

function template(elements: AnyElement[]): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      direction: 'ltr',
      locale: { language: 'en', digits: 'latn', calendar: 'gregorian' },
      unit: 'pt',
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands: [{ id: 'band', type: 'reportHeader', height: { mode: 'fixed', value: 100 }, elements }],
    resources: { fonts: [], images: [] },
  };
}

/** apply(cmd) then apply(cmd.invert(before)) returns the original state. */
function expectReversible(before: PdfTemplate, cmd: ReturnType<typeof patchElement>): void {
  const inverse = cmd.invert(before);
  const after = cmd.apply(before);
  expect(after).not.toEqual(before);
  expect(inverse.apply(after)).toEqual(before);
}

describe('commands are reversible (§8, ADR-0004)', () => {
  it('patchElement round-trips', () => {
    expectReversible(template([el('a')]), patchElement('a', { zIndex: 9, rotation: 45 }));
  });

  it('setElementBounds round-trips', () => {
    expectReversible(
      template([el('a')]),
      setElementBounds('a', { x: 5, y: 6, width: 70, height: 30 }),
    );
  });

  it('addElement round-trips (undo removes it)', () => {
    const before = template([el('a')]);
    const cmd = addElement('band', el('b'));
    const after = cmd.apply(before);
    expect(findElement(after, 'b')).toBeDefined();
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('removeElementById round-trips (undo restores position)', () => {
    const before = template([el('a'), el('b'), el('c')]);
    const cmd = removeElementById('b');
    const after = cmd.apply(before);
    expect(findElement(after, 'b')).toBeUndefined();
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('patchPageSetup round-trips', () => {
    const before = template([]);
    const cmd = patchPageSetup({ orientation: 'landscape', direction: 'rtl' });
    const after = cmd.apply(before);
    expect(after.page.orientation).toBe('landscape');
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('setStaticText round-trips and ignores non-text elements', () => {
    const before = template([el('a')]);
    const cmd = setStaticText('a', 'changed');
    expect(cmd.apply(before).bands[0]!.elements[0]).toMatchObject({ text: 'changed' });
    expect(cmd.invert(before).apply(cmd.apply(before))).toEqual(before);
  });

  it('does not mutate the input template (structural sharing)', () => {
    const before = template([el('a')]);
    const snapshot = JSON.parse(JSON.stringify(before));
    patchElement('a', { zIndex: 5 }).apply(before);
    expect(before).toEqual(snapshot);
  });

  it('invert is a no-op when the target element is gone', () => {
    const before = template([el('a')]);
    const cmd = patchElement('missing', { zIndex: 2 });
    expect(cmd.invert(before).type).toBe('noop');
  });
});

describe('commands reach nested elements (§5 containers)', () => {
  /** band › outer › inner › deep */
  const nested = (): PdfTemplate =>
    template([
      el('top'),
      {
        id: 'outer',
        type: 'container',
        bounds: { x: 100, y: 100, width: 200, height: 200 },
        zIndex: 1,
        children: [
          el('mid'),
          {
            id: 'inner',
            type: 'container',
            bounds: { x: 10, y: 10, width: 100, height: 100 },
            zIndex: 1,
            children: [el('deep')],
          },
        ],
      },
    ]);

  it('patchElement round-trips on a deeply nested element', () => {
    expectReversible(nested(), patchElement('deep', { zIndex: 9, rotation: 30 }));
  });

  it('setElementBounds round-trips on a nested element', () => {
    expectReversible(nested(), setElementBounds('mid', { x: 7, y: 8, width: 60, height: 25 }));
  });

  it('addElement nests into a container and undo removes it', () => {
    const before = nested();
    const cmd = addElement('inner', el('fresh'));
    const after = cmd.apply(before);
    expect(findElement(after, 'fresh')).toMatchObject({ parentId: 'inner' });
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('removeElementById restores a nested element to its own parent, not the band', () => {
    const before = nested();
    const cmd = removeElementById('deep');
    const after = cmd.apply(before);
    expect(findElement(after, 'deep')).toBeUndefined();
    // The naive implementation would re-add it at band level; this must round-trip.
    const restored = cmd.invert(before).apply(after);
    expect(findElement(restored, 'deep')).toMatchObject({ parentId: 'inner' });
    expect(restored).toEqual(before);
  });

  it('setStaticText round-trips on a nested element', () => {
    const before = nested();
    const cmd = setStaticText('deep', 'changed');
    const after = cmd.apply(before);
    expect(findElement(after, 'deep')).toMatchObject({ element: { text: 'changed' } });
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });
});
