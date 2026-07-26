/**
 * The visible history + remote application paths on the store: a readable list
 * of undo steps the UI can render and jump through (§8A), and `applyRemote` for
 * commands that arrive from a peer instead of this editor (ROADMAP 5.2).
 */
import type { AnyElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';
import type { Command } from './command';
import { addElement, patchElement, renameTemplate, setElementBounds } from './commands';
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
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      direction: 'ltr',
      locale: { language: 'en', digits: 'latn', calendar: 'gregorian' },
      unit: 'pt',
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands: [{ id: 'b1', type: 'reportHeader', height: { mode: 'fixed', value: 100 }, elements }],
    resources: { fonts: [], images: [] },
  };
}

const zOf = (s: PdfTemplate, id: string): number | undefined => findElement(s, id)?.element.zIndex;

describe('getHistory', () => {
  it('lists the undoable steps oldest first, labelled by command type', () => {
    const store = new DocumentStore(template());
    store.dispatch(patchElement('a', { zIndex: 2 }));
    store.dispatch(addElement('b1', el('b')));
    store.dispatch(renameTemplate('renamed'));
    expect(store.getHistory().map((s) => s.type)).toEqual([
      'patchElement',
      'addElement',
      'patchMetadata',
    ]);
    expect(store.getHistory().map((s) => s.label)).toEqual([
      'patchElement',
      'addElement',
      'patchMetadata',
    ]);
  });

  it('prefers an explicit label when a command carries one', () => {
    const labelled: Command = {
      type: 'patchElement',
      label: 'Make it bold',
      apply: (s) => patchElement('a', { zIndex: 3 }).apply(s),
      invert: (s) => patchElement('a', { zIndex: 3 }).invert(s),
    };
    const store = new DocumentStore(template());
    store.dispatch(labelled);
    expect(store.getHistory()[0]).toMatchObject({ label: 'Make it bold', type: 'patchElement' });
  });

  it('records the origin the host supplied, and omits it otherwise', () => {
    const store = new DocumentStore(template());
    store.dispatch(patchElement('a', { zIndex: 2 }), { actor: 'alireza', at: 1_700_000_000_000 });
    store.dispatch(patchElement('a', { zIndex: 3 }));
    expect(store.getHistory()[0]).toMatchObject({ actor: 'alireza', at: 1_700_000_000_000 });
    expect(store.getHistory()[1]!.actor).toBeUndefined();
    expect('at' in store.getHistory()[1]!).toBe(false);
  });

  it('reports one entry per coalesced gesture, not one per frame', () => {
    const store = new DocumentStore(template());
    for (let x = 1; x <= 5; x++) {
      store.dispatch(setElementBounds('a', { x, y: 0, width: 50, height: 20 }, true));
    }
    expect(store.getHistory()).toHaveLength(1);
  });

  it('shrinks as the user undoes, and grows again on redo', () => {
    const store = new DocumentStore(template());
    store.dispatch(patchElement('a', { zIndex: 2 }));
    store.dispatch(patchElement('a', { zIndex: 3 }));
    expect(store.getHistory()).toHaveLength(2);
    store.undo();
    expect(store.getHistory()).toHaveLength(1);
    store.redo();
    expect(store.getHistory()).toHaveLength(2);
  });

  it('is empty for a fresh store', () => {
    expect(new DocumentStore(template()).getHistory()).toEqual([]);
  });
});

describe('undoTo', () => {
  const threeSteps = (): DocumentStore => {
    const store = new DocumentStore(template());
    store.dispatch(patchElement('a', { zIndex: 2 }));
    store.dispatch(patchElement('a', { zIndex: 3 }));
    store.dispatch(patchElement('a', { zIndex: 4 }));
    return store;
  };

  it('restores the document as it looked just after the chosen step', () => {
    const store = threeSteps();
    store.undoTo(0); // keep only the first step
    expect(zOf(store.getState(), 'a')).toBe(2);
    expect(store.getHistory()).toHaveLength(1);
  });

  it('undoes everything for -1', () => {
    const store = threeSteps();
    store.undoTo(-1);
    expect(zOf(store.getState(), 'a')).toBe(1);
    expect(store.canUndo()).toBe(false);
  });

  it('leaves the document alone when the target is already current', () => {
    const store = threeSteps();
    store.undoTo(2);
    expect(zOf(store.getState(), 'a')).toBe(4);
    expect(store.getHistory()).toHaveLength(3);
  });

  it('clamps an out-of-range index instead of throwing', () => {
    const store = threeSteps();
    expect(() => store.undoTo(99)).not.toThrow();
    expect(zOf(store.getState(), 'a')).toBe(4);
    store.undoTo(-99);
    expect(zOf(store.getState(), 'a')).toBe(1);
  });

  it('leaves the undone steps redoable, in order', () => {
    const store = threeSteps();
    store.undoTo(0);
    store.redo();
    expect(zOf(store.getState(), 'a')).toBe(3);
    store.redo();
    expect(zOf(store.getState(), 'a')).toBe(4);
    expect(store.canRedo()).toBe(false);
  });
});

describe('applyRemote (collaboration, ROADMAP 5.2)', () => {
  it('updates the document without touching the local undo history', () => {
    const store = new DocumentStore(template());
    store.dispatch(patchElement('a', { zIndex: 2 }));
    const historyBefore = store.getHistory();

    store.applyRemote(addElement('b1', el('fromPeer')));
    expect(findElement(store.getState(), 'fromPeer')).toBeDefined();
    expect(store.getHistory()).toEqual(historyBefore);

    // the local undo still reverses only the local edit, leaving the peer's alone
    store.undo();
    expect(zOf(store.getState(), 'a')).toBe(1);
    expect(findElement(store.getState(), 'fromPeer')).toBeDefined();
  });

  it('does not clear the redo stack — a peer must not cost you your redo', () => {
    const store = new DocumentStore(template());
    store.dispatch(patchElement('a', { zIndex: 2 }));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.applyRemote(addElement('b1', el('fromPeer')));
    expect(store.canRedo()).toBe(true);
    store.redo();
    expect(zOf(store.getState(), 'a')).toBe(2);
  });

  it('notifies subscribers like any other change', () => {
    const store = new DocumentStore(template());
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.bands[0]!.elements.length));
    store.applyRemote(addElement('b1', el('fromPeer')));
    expect(seen).toEqual([1, 2]);
  });
});
