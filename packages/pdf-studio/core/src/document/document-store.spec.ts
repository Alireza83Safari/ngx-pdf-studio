import type { AnyElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';
import {
  addElement,
  composite,
  patchElement,
  removeElementById,
  setElementBounds,
} from './commands';
import { DocumentStore } from './document-store';
import { findElement } from './template-ops';

const el = (id: string): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x: 0, y: 0, width: 50, height: 20 },
  zIndex: 1,
  text: id,
});

function template(elements: AnyElement[] = [el('a')]): PdfTemplate {
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

const zOf = (s: PdfTemplate, id: string): number | undefined => findElement(s, id)?.element.zIndex;

describe('DocumentStore (§8, ADR-0004)', () => {
  it('dispatch applies commands immutably', () => {
    const initial = template();
    const store = new DocumentStore(initial);
    store.dispatch(patchElement('a', { zIndex: 7 }));
    expect(zOf(store.getState(), 'a')).toBe(7);
    expect(store.getState()).not.toBe(initial);
    expect(initial.bands[0]!.elements[0]!.zIndex).toBe(1); // original untouched
  });

  it('undo/redo restore and replay state exactly', () => {
    const store = new DocumentStore(template());
    const base = store.getState();
    store.dispatch(patchElement('a', { zIndex: 2 }));
    store.dispatch(patchElement('a', { zIndex: 3 }));
    expect(zOf(store.getState(), 'a')).toBe(3);

    store.undo();
    expect(zOf(store.getState(), 'a')).toBe(2);
    store.undo();
    expect(zOf(store.getState(), 'a')).toBe(1);
    expect(store.getState()).toEqual(base);
    expect(store.canUndo()).toBe(false);

    store.redo();
    expect(zOf(store.getState(), 'a')).toBe(2);
    store.redo();
    expect(zOf(store.getState(), 'a')).toBe(3);
    expect(store.canRedo()).toBe(false);
  });

  it('coalesces drag commands into a single undo step', () => {
    const store = new DocumentStore(template());
    // Simulate a drag: many bounds updates sharing a coalesce key.
    for (let x = 1; x <= 5; x++) {
      store.dispatch(setElementBounds('a', { x, y: x, width: 50, height: 20 }, true));
    }
    expect(findElement(store.getState(), 'a')!.element.bounds.x).toBe(5);

    // One undo reverts the whole drag back to the start.
    store.undo();
    expect(findElement(store.getState(), 'a')!.element.bounds.x).toBe(0);
    expect(store.canUndo()).toBe(false);
  });

  it('does not coalesce when no coalesce key is set', () => {
    const store = new DocumentStore(template());
    store.dispatch(setElementBounds('a', { x: 1, y: 1, width: 50, height: 20 }));
    store.dispatch(setElementBounds('a', { x: 2, y: 2, width: 50, height: 20 }));
    store.undo();
    expect(findElement(store.getState(), 'a')!.element.bounds.x).toBe(1);
  });

  it('a new dispatch invalidates the redo stack', () => {
    const store = new DocumentStore(template());
    store.dispatch(patchElement('a', { zIndex: 2 }));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.dispatch(patchElement('a', { zIndex: 9 }));
    expect(store.canRedo()).toBe(false);
    expect(zOf(store.getState(), 'a')).toBe(9);
  });

  it('notifies subscribers immediately and on every change; unsubscribe stops it', () => {
    const store = new DocumentStore(template());
    const seen: number[] = [];
    const unsubscribe = store.subscribe((s) => seen.push(zOf(s, 'a') ?? -1));
    expect(seen).toEqual([1]); // immediate current state
    store.dispatch(patchElement('a', { zIndex: 4 }));
    expect(seen).toEqual([1, 4]);
    unsubscribe();
    store.dispatch(patchElement('a', { zIndex: 5 }));
    expect(seen).toEqual([1, 4]); // no further notifications
  });

  it('undo/redo with nothing to do is a safe no-op', () => {
    const store = new DocumentStore(template());
    expect(() => {
      store.undo();
      store.redo();
    }).not.toThrow();
  });

  it('supports add + undo across the element lifecycle', () => {
    const store = new DocumentStore(template());
    store.dispatch(addElement('band', el('b')));
    expect(findElement(store.getState(), 'b')).toBeDefined();
    store.undo();
    expect(findElement(store.getState(), 'b')).toBeUndefined();
  });
});

describe('composite command (atomic multi-element steps)', () => {
  const template3 = (): PdfTemplate => template([el('a'), el('b'), el('c')]);
  const ids = (s: PdfTemplate): string[] => s.bands[0]!.elements.map((e) => e.id);

  it('deletes many elements as ONE undo step', () => {
    const store = new DocumentStore(template3());
    store.dispatch(composite([el('a'), el('b'), el('c')].map((e) => removeElementById(e.id))));
    expect(ids(store.getState())).toEqual([]);
    // a single undo restores all three, in their original order
    store.undo();
    expect(ids(store.getState())).toEqual(['a', 'b', 'c']);
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect(ids(store.getState())).toEqual([]);
  });

  it('duplicates many elements as ONE undo step', () => {
    const store = new DocumentStore(template3());
    store.dispatch(composite([addElement('band', el('a2')), addElement('band', el('b2'))]));
    expect(ids(store.getState())).toEqual(['a', 'b', 'c', 'a2', 'b2']);
    store.undo();
    expect(ids(store.getState())).toEqual(['a', 'b', 'c']);
  });

  it('coalesces group-drag composites of the same gesture into one undo', () => {
    const store = new DocumentStore(template3());
    for (let x = 1; x <= 4; x++) {
      store.dispatch(
        composite(
          ['a', 'b'].map((id) => setElementBounds(id, { x, y: x, width: 50, height: 20 })),
          'drag:group',
        ),
      );
    }
    expect(findElement(store.getState(), 'a')!.element.bounds.x).toBe(4);
    expect(findElement(store.getState(), 'b')!.element.bounds.x).toBe(4);
    store.undo(); // reverts the whole gesture for both elements at once
    expect(findElement(store.getState(), 'a')!.element.bounds.x).toBe(0);
    expect(findElement(store.getState(), 'b')!.element.bounds.x).toBe(0);
    expect(store.canUndo()).toBe(false);
  });

  it('unwraps to the single command when given one (no coalesce key)', () => {
    const store = new DocumentStore(template3());
    store.dispatch(composite([removeElementById('b')]));
    expect(ids(store.getState())).toEqual(['a', 'c']);
    store.undo();
    expect(ids(store.getState())).toEqual(['a', 'b', 'c']);
  });
});
