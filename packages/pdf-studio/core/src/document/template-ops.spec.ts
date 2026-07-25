import type { AnyElement, ContainerElement, ListElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';
import {
  elementChildren,
  findElement,
  insertElement,
  removeElement,
  updateElement,
} from './template-ops';

const el = (id: string): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x: 0, y: 0, width: 50, height: 20 },
  zIndex: 1,
  text: id,
});

const container = (id: string, children: AnyElement[]): ContainerElement => ({
  id,
  type: 'container',
  bounds: { x: 100, y: 100, width: 200, height: 200 },
  zIndex: 1,
  children,
});

const list = (id: string, itemTemplate: AnyElement[]): ListElement => ({
  id,
  type: 'list',
  bounds: { x: 0, y: 300, width: 200, height: 100 },
  zIndex: 1,
  dataset: 'rows',
  itemTemplate,
  itemHeight: 20,
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
    bands: [
      { id: 'b1', type: 'reportHeader', height: { mode: 'fixed', value: 100 }, elements },
      { id: 'b2', type: 'detail', height: { mode: 'fixed', value: 40 }, elements: [el('other')] },
    ],
    resources: { fonts: [], images: [] },
  };
}

/** Two levels of nesting: b1 › outer › inner › deep. */
const nested = (): PdfTemplate =>
  template([el('top'), container('outer', [el('mid'), container('inner', [el('deep')])])]);

describe('elementChildren', () => {
  it('reports children for composite elements and undefined for leaves', () => {
    expect(elementChildren(container('c', [el('x')]))).toEqual([el('x')]);
    expect(elementChildren(list('l', [el('y')]))).toEqual([el('y')]);
    expect(elementChildren(el('leaf'))).toBeUndefined();
  });
});

describe('findElement locates elements at any depth (§5 nesting)', () => {
  it('reports the band, index and empty path for a top-level element', () => {
    expect(findElement(nested(), 'top')).toMatchObject({
      bandId: 'b1',
      bandIndex: 0,
      index: 0,
      containerPath: [],
      parentId: 'b1',
    });
  });

  it('reports the container path and the immediate parent for a nested element', () => {
    expect(findElement(nested(), 'mid')).toMatchObject({
      bandId: 'b1',
      index: 0,
      containerPath: ['outer'],
      parentId: 'outer',
    });
  });

  it('walks arbitrarily deep, keeping the index relative to the immediate parent', () => {
    expect(findElement(nested(), 'deep')).toMatchObject({
      bandId: 'b1',
      containerPath: ['outer', 'inner'],
      parentId: 'inner',
      index: 0,
    });
  });

  it('finds elements inside a list item template', () => {
    const t = template([list('l', [el('a'), el('cell')])]);
    expect(findElement(t, 'cell')).toMatchObject({
      bandId: 'b1',
      containerPath: ['l'],
      parentId: 'l',
      index: 1,
    });
  });

  it('searches every band', () => {
    expect(findElement(nested(), 'other')).toMatchObject({ bandId: 'b2', bandIndex: 1 });
  });

  it('returns undefined for an unknown id', () => {
    expect(findElement(nested(), 'nope')).toBeUndefined();
  });
});

describe('updateElement reaches nested elements', () => {
  it('updates an element two levels down', () => {
    const next = updateElement(nested(), 'deep', (e) => ({ ...e, zIndex: 42 }));
    expect(findElement(next, 'deep')!.element.zIndex).toBe(42);
  });

  it('updates an element inside a list item template', () => {
    const t = template([list('l', [el('cell')])]);
    const next = updateElement(t, 'cell', (e) => ({ ...e, zIndex: 9 }));
    expect((next.bands[0]!.elements[0] as ListElement).itemTemplate[0]!.zIndex).toBe(9);
  });

  it('never mutates the input tree', () => {
    const before = nested();
    const snapshot = JSON.parse(JSON.stringify(before));
    updateElement(before, 'deep', (e) => ({ ...e, zIndex: 7 }));
    expect(before).toEqual(snapshot);
  });

  it('keeps untouched bands and sibling subtrees referentially identical', () => {
    const before = nested();
    const next = updateElement(before, 'deep', (e) => ({ ...e, zIndex: 7 }));
    expect(next.bands[1]).toBe(before.bands[1]); // untouched band
    expect(next.bands[0]!.elements[0]).toBe(before.bands[0]!.elements[0]); // untouched sibling
    expect(next.bands[0]!.elements[1]).not.toBe(before.bands[0]!.elements[1]); // on the path
  });

  it('returns the same template when the id is absent', () => {
    const before = nested();
    expect(updateElement(before, 'nope', (e) => e)).toBe(before);
  });
});

describe('insertElement targets bands and composite elements', () => {
  it('appends to a band by default', () => {
    const next = insertElement(nested(), 'b1', el('new'));
    expect(next.bands[0]!.elements.map((e) => e.id)).toEqual(['top', 'outer', 'new']);
  });

  it('inserts into a band at an index, clamping out-of-range values', () => {
    expect(insertElement(nested(), 'b1', el('new'), 0).bands[0]!.elements[0]!.id).toBe('new');
    const far = insertElement(nested(), 'b1', el('new'), 99);
    expect(far.bands[0]!.elements.map((e) => e.id)).toEqual(['top', 'outer', 'new']);
  });

  it('nests into a container by id', () => {
    const next = insertElement(nested(), 'inner', el('new'));
    expect(findElement(next, 'new')).toMatchObject({
      parentId: 'inner',
      containerPath: ['outer', 'inner'],
    });
  });

  it('nests into a list item template by id', () => {
    const t = template([list('l', [el('cell')])]);
    const next = insertElement(t, 'l', el('new'), 0);
    expect((next.bands[0]!.elements[0] as ListElement).itemTemplate.map((e) => e.id)).toEqual([
      'new',
      'cell',
    ]);
  });

  it('resolves a band before an element of the same id', () => {
    // A band named like a container must keep band semantics (back-compat).
    const t = template([container('b1', [])]);
    const next = insertElement(t, 'b1', el('new'));
    expect(next.bands[0]!.elements.map((e) => e.id)).toEqual(['b1', 'new']);
  });

  it('returns the same template for an unknown parent', () => {
    const before = nested();
    expect(insertElement(before, 'nope', el('new'))).toBe(before);
  });
});

describe('removeElement reaches nested elements', () => {
  it('removes a deeply nested element, leaving the rest intact', () => {
    const next = removeElement(nested(), 'deep');
    expect(findElement(next, 'deep')).toBeUndefined();
    expect(findElement(next, 'inner')).toBeDefined();
    expect(findElement(next, 'mid')).toBeDefined();
  });

  it('removing a container removes its whole subtree', () => {
    const next = removeElement(nested(), 'outer');
    expect(findElement(next, 'mid')).toBeUndefined();
    expect(findElement(next, 'deep')).toBeUndefined();
    expect(findElement(next, 'top')).toBeDefined();
  });

  it('removes an element from a list item template', () => {
    const t = template([list('l', [el('a'), el('b')])]);
    const next = removeElement(t, 'a');
    expect((next.bands[0]!.elements[0] as ListElement).itemTemplate.map((e) => e.id)).toEqual([
      'b',
    ]);
  });

  it('returns the same template when the id is absent', () => {
    const before = nested();
    expect(removeElement(before, 'nope')).toBe(before);
  });
});
