/**
 * Editor-only element affordances (§8A): a friendly layer name, an editing lock,
 * and sibling-relative z-order. None of them may change what gets rendered.
 */
import { layoutDocument } from '../render';
import type { AnyElement, ContainerElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';
import { validateTemplate } from '../validation/validate';
import { deserializeTemplate, serializeTemplate } from '../serialization/serialize';
import { moveElementZ, renameElement, setElementLocked } from './commands';
import { DocumentStore } from './document-store';
import { findElement } from './template-ops';

const el = (id: string, zIndex: number): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x: 0, y: 0, width: 40, height: 20 },
  zIndex,
  text: id,
});

function template(elements: AnyElement[]): PdfTemplate {
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

const stack = (): PdfTemplate => template([el('a', 1), el('b', 2), el('c', 3)]);
const zOf = (t: PdfTemplate, id: string): number => findElement(t, id)!.element.zIndex;

describe('renameElement / setElementLocked', () => {
  it('renameElement round-trips through the store', () => {
    const store = new DocumentStore(stack());
    const before = store.getState();
    store.dispatch(renameElement('a', 'سربرگ'));
    expect(findElement(store.getState(), 'a')!.element.name).toBe('سربرگ');
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('setElementLocked toggles and undo restores the previous state', () => {
    const store = new DocumentStore(stack());
    store.dispatch(setElementLocked('a', true));
    expect(findElement(store.getState(), 'a')!.element.locked).toBe(true);
    store.dispatch(setElementLocked('a', false));
    expect(findElement(store.getState(), 'a')!.element.locked).toBe(false);
    store.undo();
    expect(findElement(store.getState(), 'a')!.element.locked).toBe(true);
    store.undo();
    expect(findElement(store.getState(), 'a')!.element.locked).toBeUndefined();
  });

  it('neither name nor locked changes the rendered output', () => {
    const before = stack();
    const decorated = setElementLocked('a', true).apply(renameElement('a', 'x').apply(before));
    const geometry = (t: PdfTemplate): unknown =>
      layoutDocument(t, {}).pages.flatMap((p) =>
        p.elements.map((e) => [e.id, e.bounds, 'text' in e ? e.text : null]),
      );
    expect(geometry(decorated)).toEqual(geometry(before));
  });

  it('both survive validation and a serialization round-trip', () => {
    const t = setElementLocked('a', true).apply(renameElement('a', 'لوگو').apply(stack()));
    expect(validateTemplate(t).success).toBe(true);
    const back = deserializeTemplate(serializeTemplate(t));
    expect(findElement(back, 'a')!.element).toMatchObject({ name: 'لوگو', locked: true });
  });
});

describe('moveElementZ restacks relative to siblings', () => {
  it('front puts the element above every sibling', () => {
    const after = moveElementZ('a', 'front').apply(stack());
    expect(zOf(after, 'a')).toBe(4);
    expect([zOf(after, 'b'), zOf(after, 'c')]).toEqual([2, 3]);
  });

  it('back puts the element below every sibling', () => {
    expect(zOf(moveElementZ('c', 'back').apply(stack()), 'c')).toBe(0);
  });

  it('forward swaps with the next sibling up, one step at a time', () => {
    const order = (t: PdfTemplate): string[] =>
      t.bands[0]!.elements.slice()
        .sort((x, y) => x.zIndex - y.zIndex)
        .map((e) => e.id);
    const once = moveElementZ('a', 'forward').apply(stack());
    expect(order(once)).toEqual(['b', 'a', 'c']);
    expect([zOf(once, 'a'), zOf(once, 'b')]).toEqual([2, 1]); // swapped, not inflated
    const twice = moveElementZ('a', 'forward').apply(once);
    expect(order(twice)).toEqual(['b', 'c', 'a']);
  });

  it('backward swaps with the next sibling down', () => {
    const after = moveElementZ('c', 'backward').apply(stack());
    expect([zOf(after, 'c'), zOf(after, 'b')]).toEqual([2, 3]);
  });

  it('a forward/backward swap round-trips through the store', () => {
    const store = new DocumentStore(stack());
    const before = store.getState();
    store.dispatch(moveElementZ('a', 'forward'));
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('is a no-op at the end of the stack', () => {
    const t = stack();
    expect(moveElementZ('c', 'front').apply(t)).toBe(t);
    expect(moveElementZ('c', 'forward').apply(t)).toBe(t);
    expect(moveElementZ('a', 'back').apply(t)).toBe(t);
    expect(moveElementZ('a', 'backward').apply(t)).toBe(t);
    expect(moveElementZ('c', 'front').invert(t).type).toBe('noop');
  });

  it('is a no-op for an unknown id or a lone element', () => {
    const t = stack();
    expect(moveElementZ('nope', 'front').apply(t)).toBe(t);
    const lone = template([el('only', 1)]);
    expect(moveElementZ('only', 'front').apply(lone)).toBe(lone);
  });

  it('round-trips through the store', () => {
    const store = new DocumentStore(stack());
    const before = store.getState();
    store.dispatch(moveElementZ('a', 'front'));
    expect(zOf(store.getState(), 'a')).toBe(4);
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('compares only against siblings inside a container, not the whole band', () => {
    const t = template([
      el('outside', 99),
      {
        id: 'grp',
        type: 'container',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        zIndex: 1,
        children: [el('in1', 1), el('in2', 2)],
      },
    ]);
    const after = moveElementZ('in1', 'front').apply(t);
    // 3, not 100 — the band's z values are irrelevant inside a group
    expect(zOf(after, 'in1')).toBe(3);
    expect(
      (findElement(after, 'grp')!.element as ContainerElement).children.map((c) => c.id),
    ).toEqual(['in1', 'in2']);
  });
});
