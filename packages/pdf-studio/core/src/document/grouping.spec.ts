/**
 * Group/ungroup (§8A). The load-bearing property is that grouping is a pure
 * regrouping of the tree: a container's children are painted relative to its
 * top-left (`layout/paginate.ts`), so the laid-out geometry must be identical
 * before and after — verified here against the real layout engine, not just by
 * inspecting bounds.
 */
import { layoutDocument } from '../render';
import type { AnyElement, ContainerElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';
import { DocumentStore } from './document-store';
import { groupElements, moveElementsBy, ungroupContainer } from './commands';
import { findElement } from './template-ops';

const el = (id: string, x: number, y: number, w = 40, h = 20, zIndex = 1): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x, y, width: w, height: h },
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
    bands: [
      { id: 'b1', type: 'reportHeader', height: { mode: 'fixed', value: 200 }, elements },
      {
        id: 'b2',
        type: 'detail',
        height: { mode: 'fixed', value: 40 },
        elements: [el('far', 0, 0)],
      },
    ],
    resources: { fonts: [], images: [] },
  };
}

/** Three elements spanning (10,10)-(150,90). */
const three = (): PdfTemplate =>
  template([el('a', 10, 10), el('b', 60, 40, 40, 20, 5), el('c', 110, 70)]);

const containerOf = (t: PdfTemplate, id: string): ContainerElement =>
  findElement(t, id)!.element as ContainerElement;

/** Painted (id, x, y, w, h) of every leaf, for geometry comparison. */
function paintedGeometry(t: PdfTemplate): string[] {
  return layoutDocument(t, {})
    .pages.flatMap((p) => p.elements)
    .map((e) => `${e.id} ${e.bounds.x} ${e.bounds.y} ${e.bounds.width} ${e.bounds.height}`)
    .sort();
}

describe('groupElements', () => {
  it('wraps the selection in a container sized to its bounding box', () => {
    const after = groupElements(['a', 'b', 'c'], 'g1').apply(three());
    expect(containerOf(after, 'g1').bounds).toEqual({ x: 10, y: 10, width: 140, height: 80 });
  });

  it('rebases children into container-local coordinates', () => {
    const after = groupElements(['a', 'b', 'c'], 'g1').apply(three());
    expect(containerOf(after, 'g1').children.map((c) => [c.id, c.bounds.x, c.bounds.y])).toEqual([
      ['a', 0, 0],
      ['b', 50, 30],
      ['c', 100, 60],
    ]);
  });

  it('removes the originals from the band and leaves the container in their place', () => {
    const after = groupElements(['a', 'b', 'c'], 'g1').apply(three());
    expect(after.bands[0]!.elements.map((e) => e.id)).toEqual(['g1']);
    expect(findElement(after, 'a')).toMatchObject({ parentId: 'g1' });
  });

  it('takes the highest zIndex in the group', () => {
    expect(containerOf(groupElements(['a', 'b', 'c'], 'g1').apply(three()), 'g1').zIndex).toBe(5);
  });

  it('lands at the position of the frontmost member and keeps child order', () => {
    const t = template([el('x', 0, 0), el('a', 10, 10), el('b', 60, 40), el('y', 0, 0)]);
    const after = groupElements(['b', 'a'], 'g1').apply(t);
    // inserted where the first (document-order) member was, i.e. after 'x'
    expect(after.bands[0]!.elements.map((e) => e.id)).toEqual(['x', 'g1', 'y']);
    expect(containerOf(after, 'g1').children.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('groups inside an existing container, staying container-local', () => {
    const t = template([
      {
        id: 'outer',
        type: 'container',
        bounds: { x: 100, y: 100, width: 200, height: 200 },
        zIndex: 1,
        children: [el('p', 10, 10), el('q', 60, 40)],
      },
    ]);
    const after = groupElements(['p', 'q'], 'g1').apply(t);
    expect(findElement(after, 'g1')).toMatchObject({ parentId: 'outer' });
    expect(containerOf(after, 'g1').bounds).toEqual({ x: 10, y: 10, width: 90, height: 50 });
    expect(containerOf(after, 'g1').children.map((c) => [c.id, c.bounds.x, c.bounds.y])).toEqual([
      ['p', 0, 0],
      ['q', 50, 30],
    ]);
  });

  it('ignores ids that do not exist', () => {
    const after = groupElements(['a', 'ghost', 'b'], 'g1').apply(three());
    expect(containerOf(after, 'g1').children.map((c) => c.id)).toEqual(['a', 'b']);
    expect(after.bands[0]!.elements.map((e) => e.id)).toEqual(['g1', 'c']);
  });

  it('refuses to group across different parents, keeping the first one', () => {
    // 'far' lives in another band — its bounds are relative to a different origin
    const after = groupElements(['a', 'far', 'b'], 'g1').apply(three());
    expect(containerOf(after, 'g1').children.map((c) => c.id)).toEqual(['a', 'b']);
    expect(findElement(after, 'far')).toMatchObject({ bandId: 'b2' });
  });

  it('does nothing when fewer than two elements survive resolution', () => {
    const before = three();
    expect(groupElements(['a'], 'g1').apply(before)).toBe(before);
    expect(groupElements(['a', 'ghost'], 'g1').apply(before)).toBe(before);
    expect(groupElements([], 'g1').apply(before)).toBe(before);
  });
});

describe('ungroupContainer', () => {
  it('folds the container offset back into its children', () => {
    const grouped = groupElements(['a', 'b', 'c'], 'g1').apply(three());
    const after = ungroupContainer('g1').apply(grouped);
    expect(findElement(after, 'a')!.element.bounds).toMatchObject({ x: 10, y: 10 });
    expect(findElement(after, 'b')!.element.bounds).toMatchObject({ x: 60, y: 40 });
    expect(findElement(after, 'c')!.element.bounds).toMatchObject({ x: 110, y: 70 });
  });

  it('returns children to the container position, in order', () => {
    const t = template([el('x', 0, 0), el('a', 10, 10), el('b', 60, 40), el('y', 0, 0)]);
    const grouped = groupElements(['a', 'b'], 'g1').apply(t);
    const after = ungroupContainer('g1').apply(grouped);
    expect(after.bands[0]!.elements.map((e) => e.id)).toEqual(['x', 'a', 'b', 'y']);
  });

  it('ungroups into the parent container when nested', () => {
    const t = template([
      {
        id: 'outer',
        type: 'container',
        bounds: { x: 100, y: 100, width: 200, height: 200 },
        zIndex: 1,
        children: [el('p', 10, 10), el('q', 60, 40)],
      },
    ]);
    const after = ungroupContainer('g1').apply(groupElements(['p', 'q'], 'g1').apply(t));
    expect(findElement(after, 'p')).toMatchObject({ parentId: 'outer' });
    expect(findElement(after, 'p')!.element.bounds).toMatchObject({ x: 10, y: 10 });
  });

  it('is a no-op for a missing id or a non-container element', () => {
    const before = three();
    expect(ungroupContainer('nope').apply(before)).toBe(before);
    expect(ungroupContainer('a').apply(before)).toBe(before);
    expect(ungroupContainer('a').invert(before).type).toBe('noop');
  });

  it('dissolving an empty container just removes it', () => {
    const t = template([
      {
        id: 'g1',
        type: 'container',
        bounds: { x: 5, y: 5, width: 10, height: 10 },
        zIndex: 1,
        children: [],
      },
      el('a', 0, 0),
    ]);
    const after = ungroupContainer('g1').apply(t);
    expect(after.bands[0]!.elements.map((e) => e.id)).toEqual(['a']);
  });
});

describe('grouping is reversible and geometry-preserving', () => {
  it('group then undo restores the exact original template', () => {
    const store = new DocumentStore(three());
    const before = store.getState();
    store.dispatch(groupElements(['a', 'b', 'c'], 'g1'));
    expect(findElement(store.getState(), 'g1')).toBeDefined();
    store.undo();
    expect(store.getState()).toEqual(before);
    expect(store.canUndo()).toBe(false);
  });

  it('ungroup then undo restores the container, bounds and child order', () => {
    const store = new DocumentStore(groupElements(['a', 'b', 'c'], 'g1').apply(three()));
    const grouped = store.getState();
    store.dispatch(ungroupContainer('g1'));
    expect(findElement(store.getState(), 'g1')).toBeUndefined();
    store.undo();
    expect(store.getState()).toEqual(grouped);
  });

  it('group -> ungroup is the identity on the template', () => {
    const before = three();
    const round = ungroupContainer('g1').apply(groupElements(['a', 'b', 'c'], 'g1').apply(before));
    expect(round).toEqual(before);
  });

  it('leaves the painted geometry byte-for-byte identical', () => {
    const before = three();
    const grouped = groupElements(['a', 'b', 'c'], 'g1').apply(before);
    // the container itself paints a (transparent) box, so compare only the leaves
    const leaves = (t: PdfTemplate): string[] =>
      paintedGeometry(t).filter((s) => !s.startsWith('g1 '));
    expect(leaves(grouped)).toEqual(leaves(before));
    expect(leaves(ungroupContainer('g1').apply(grouped))).toEqual(leaves(before));
  });

  it('moving the group moves every child, and undo brings them all back', () => {
    const store = new DocumentStore(groupElements(['a', 'b', 'c'], 'g1').apply(three()));
    const painted = paintedGeometry(store.getState());
    store.dispatch(moveElementsBy(['g1'], 25, 15));
    // children keep their container-local bounds; only the container moved
    expect(containerOf(store.getState(), 'g1').bounds).toMatchObject({ x: 35, y: 25 });
    expect(findElement(store.getState(), 'a')!.element.bounds).toMatchObject({ x: 0, y: 0 });
    // …but every painted child shifted with it
    const movedIds = paintedGeometry(store.getState());
    expect(movedIds).not.toEqual(painted);
    store.undo();
    expect(paintedGeometry(store.getState())).toEqual(painted);
  });
});
