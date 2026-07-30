/**
 * Coverage for the command vocabulary the designer actually uses — element
 * multi-edits, band structure, and document-level commands. These lived in
 * `apps/playground/designer/designer.js` untested before being moved into core.
 */
import type { Band } from '../model/band';
import type { AnyElement, TableElement } from '../model/elements';
import type { NamedStyle } from '../model/style';
import type { PdfTemplate } from '../model/template';
import type { Command } from './command';
import {
  addBand,
  addElement,
  composite,
  ensureDataset,
  ensureImageResource,
  ensureStyles,
  modifyElement,
  pruneImageResources,
  moveBand,
  moveElementsBy,
  patchBand,
  patchMetadata,
  removeBandById,
  renameTemplate,
  replaceElement,
  replaceTemplate,
  setElementsBounds,
} from './commands';
import { DocumentStore } from './document-store';
import { findElement } from './template-ops';

const el = (id: string, x = 0, y = 0): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x, y, width: 50, height: 20 },
  zIndex: 1,
  text: id,
});

const band = (id: string, type: Band['type'] = 'detail'): Band => ({
  id,
  type,
  height: { mode: 'fixed', value: 40 },
  elements: [],
});

function template(overrides: Partial<PdfTemplate> = {}): PdfTemplate {
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
      {
        id: 'b1',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 100 },
        elements: [el('a', 0, 0), el('b', 100, 50)],
      },
    ],
    resources: { fonts: [], images: [] },
    ...overrides,
  };
}

/** apply(cmd) then apply(cmd.invert(before)) returns the original state. */
function expectReversible(before: PdfTemplate, cmd: Command): void {
  const inverse = cmd.invert(before);
  const after = cmd.apply(before);
  expect(after).not.toEqual(before);
  expect(inverse.apply(after)).toEqual(before);
}

const boundsOf = (t: PdfTemplate, id: string): AnyElement['bounds'] =>
  findElement(t, id)!.element.bounds;
const bandIds = (t: PdfTemplate): string[] => t.bands.map((b) => b.id);

describe('image resources (designer-ux 1.3)', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA';
  const logo = { id: 'img-1', mime: 'image/png' as const, data: PNG, width: 1, height: 1 };
  const imageEl = (id: string, resourceId: string): AnyElement =>
    ({
      id,
      type: 'image',
      bounds: { x: 0, y: 0, width: 40, height: 40 },
      zIndex: 1,
      resourceId,
    }) as AnyElement;

  it('adds a resource and undo removes it again', () => {
    expectReversible(template(), ensureImageResource(logo));
  });

  it('is idempotent — re-adding the same id does not duplicate the bytes', () => {
    const once = ensureImageResource(logo).apply(template());
    const twice = ensureImageResource(logo).apply(once);
    expect(twice.resources.images).toHaveLength(1);
    expect(twice).toBe(once); // untouched state is returned by reference
  });

  it('pairs with addElement as one undo step', () => {
    const store = new DocumentStore(template());
    store.dispatch(
      composite([ensureImageResource(logo), addElement('b1', imageEl('logo-el', 'img-1'))]),
    );
    expect(store.getState().resources.images).toHaveLength(1);
    store.undo();
    expect(store.getState().resources.images).toHaveLength(0);
    expect(findElement(store.getState(), 'logo-el')).toBeUndefined();
  });

  it('prunes only the images no element references', () => {
    const used = { ...logo, id: 'used' };
    const orphan = { ...logo, id: 'orphan' };
    const before = ensureImageResource(orphan).apply(
      ensureImageResource(used).apply(addElement('b1', imageEl('e', 'used')).apply(template())),
    );
    const after = pruneImageResources().apply(before);
    expect(after.resources.images.map((i) => i.id)).toEqual(['used']);
  });

  it('finds references inside containers, and undo restores what it pruned', () => {
    const withGroup = addElement('b1', {
      id: 'grp',
      type: 'container',
      bounds: { x: 0, y: 0, width: 80, height: 80 },
      zIndex: 1,
      children: [imageEl('nested', 'deep')],
    } as AnyElement).apply(template());
    const before = ensureImageResource({ ...logo, id: 'deep' }).apply(withGroup);
    // nothing to prune: the only image is referenced from inside the group
    expect(pruneImageResources().apply(before)).toBe(before);

    const withOrphan = ensureImageResource({ ...logo, id: 'gone' }).apply(before);
    expectReversible(withOrphan, pruneImageResources());
  });

  it('prunes nothing, reversibly, when every image is in use', () => {
    const t = template();
    expect(pruneImageResources().invert(t)).toEqual(expect.objectContaining({ type: 'noop' }));
  });
});

describe('element commands: whole-element and multi-element edits', () => {
  it('replaceElement round-trips, reaching type-specific properties', () => {
    const table: TableElement = {
      id: 'a',
      type: 'table',
      bounds: { x: 0, y: 0, width: 300, height: 80 },
      zIndex: 1,
      dataset: 'rows',
      columns: [{ id: 'c1', width: { kind: 'auto' } }],
    };
    expectReversible(template(), replaceElement('a', table));
  });

  it('modifyElement applies an updater and undo restores the whole element', () => {
    const before = template();
    const cmd = modifyElement('a', (e) => ({ ...e, zIndex: e.zIndex + 10 }));
    const after = cmd.apply(before);
    expect(findElement(after, 'a')!.element.zIndex).toBe(11);
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('modifyElement and replaceElement invert to a no-op when the target is gone', () => {
    const before = template();
    expect(modifyElement('missing', (e) => e).invert(before).type).toBe('noop');
    expect(replaceElement('missing', el('missing')).invert(before).type).toBe('noop');
  });

  it('setElementsBounds moves several elements as one reversible step', () => {
    const before = template();
    const cmd = setElementsBounds({
      a: { x: 5, y: 5, width: 50, height: 20 },
      b: { x: 200, y: 10, width: 60, height: 30 },
    });
    const after = cmd.apply(before);
    expect(boundsOf(after, 'a')).toMatchObject({ x: 5, y: 5 });
    expect(boundsOf(after, 'b')).toMatchObject({ x: 200, width: 60 });
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('setElementsBounds skips ids that no longer exist', () => {
    const before = template();
    const cmd = setElementsBounds({
      a: { x: 5, y: 5, width: 50, height: 20 },
      gone: { x: 9, y: 9, width: 9, height: 9 },
    });
    expect(() => cmd.invert(before).apply(cmd.apply(before))).not.toThrow();
    expect(cmd.invert(before).apply(cmd.apply(before))).toEqual(before);
  });

  it('setElementsBounds coalesces a whole group drag into one undo step', () => {
    const store = new DocumentStore(template());
    for (let x = 1; x <= 4; x++) {
      store.dispatch(
        setElementsBounds(
          {
            a: { x, y: 0, width: 50, height: 20 },
            b: { x: 100 + x, y: 50, width: 50, height: 20 },
          },
          'drag:group',
        ),
      );
    }
    expect(boundsOf(store.getState(), 'a').x).toBe(4);
    store.undo();
    expect(boundsOf(store.getState(), 'a').x).toBe(0);
    expect(boundsOf(store.getState(), 'b').x).toBe(100);
    expect(store.canUndo()).toBe(false);
  });

  it('moveElementsBy nudges a selection and is its own inverse', () => {
    const before = template();
    const cmd = moveElementsBy(['a', 'b'], 4, -2);
    const after = cmd.apply(before);
    expect(boundsOf(after, 'a')).toMatchObject({ x: 4, y: -2 });
    expect(boundsOf(after, 'b')).toMatchObject({ x: 104, y: 48 });
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('moveElementsBy never carries a coalesce key (relative deltas cannot merge)', () => {
    expect(moveElementsBy(['a'], 1, 1).coalesceKey).toBeUndefined();
  });
});

describe('band commands (§6)', () => {
  const two = (): PdfTemplate => template({ bands: [band('b1', 'reportHeader'), band('b2')] });

  it('patchBand round-trips', () => {
    expectReversible(
      two(),
      patchBand('b2', { height: { mode: 'auto', min: 20 }, dataset: 'rows' }),
    );
  });

  it('patchBand is addressed by id, so it survives a reorder', () => {
    const store = new DocumentStore(two());
    store.dispatch(moveBand(0, 1)); // b2, b1
    store.dispatch(patchBand('b1', { dataset: 'rows' }));
    expect(store.getState().bands.find((b) => b.id === 'b1')!.dataset).toBe('rows');
    store.undo();
    expect(store.getState().bands.find((b) => b.id === 'b1')!.dataset).toBeUndefined();
  });

  it('patchBand on an unknown band changes nothing and inverts to a no-op', () => {
    const before = two();
    const cmd = patchBand('nope', { dataset: 'x' });
    expect(cmd.apply(before)).toBe(before);
    expect(cmd.invert(before).type).toBe('noop');
  });

  it('addBand appends by default and round-trips', () => {
    const before = two();
    const cmd = addBand(band('b3'));
    expect(bandIds(cmd.apply(before))).toEqual(['b1', 'b2', 'b3']);
    expect(cmd.invert(before).apply(cmd.apply(before))).toEqual(before);
  });

  it('addBand inserts at an index, clamping out-of-range values', () => {
    expect(bandIds(addBand(band('b0'), 0).apply(two()))).toEqual(['b0', 'b1', 'b2']);
    expect(bandIds(addBand(band('b9'), 99).apply(two()))).toEqual(['b1', 'b2', 'b9']);
  });

  it('removeBandById restores the band at its original position on undo', () => {
    const store = new DocumentStore(template({ bands: [band('b1'), band('b2'), band('b3')] }));
    store.dispatch(removeBandById('b2'));
    expect(bandIds(store.getState())).toEqual(['b1', 'b3']);
    store.undo();
    expect(bandIds(store.getState())).toEqual(['b1', 'b2', 'b3']);
  });

  it('removeBandById on an unknown band inverts to a no-op', () => {
    expect(removeBandById('nope').invert(two()).type).toBe('noop');
  });

  it('moveBand reorders and undo restores the original order', () => {
    const store = new DocumentStore(template({ bands: [band('b1'), band('b2'), band('b3')] }));
    store.dispatch(moveBand(2, 0));
    expect(bandIds(store.getState())).toEqual(['b3', 'b1', 'b2']);
    store.undo();
    expect(bandIds(store.getState())).toEqual(['b1', 'b2', 'b3']);
  });

  it('moveBand with an out-of-range source leaves the template untouched', () => {
    const before = two();
    expect(moveBand(9, 0).apply(before)).toBe(before);
  });

  it('band elements survive a reorder (bands carry their own content)', () => {
    const withEls = template({
      bands: [{ ...band('b1'), elements: [el('a')] }, band('b2')],
    });
    const moved = moveBand(0, 1).apply(withEls);
    expect(moved.bands[1]!.elements.map((e) => e.id)).toEqual(['a']);
    expect(findElement(moved, 'a')).toMatchObject({ bandId: 'b1', bandIndex: 1 });
  });
});

describe('document commands', () => {
  it('renameTemplate round-trips', () => {
    expectReversible(template(), renameTemplate('renamed'));
  });

  it('patchMetadata round-trips and restores keys that were absent', () => {
    const before = template();
    const cmd = patchMetadata({ author: 'alireza', tags: ['invoice'] });
    const after = cmd.apply(before);
    expect(after.metadata).toMatchObject({ name: 't', author: 'alireza' });
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('ensureStyles adds only what is missing', () => {
    const style = (id: string): NamedStyle => ({ id, name: id, typography: { fontSize: 10 } });
    const before = template({ styles: [style('existing')] });
    const cmd = ensureStyles([style('existing'), style('fresh')]);
    const after = cmd.apply(before);
    expect(after.styles.map((s) => s.id)).toEqual(['existing', 'fresh']);
  });

  it('ensureStyles undo removes only the styles it added, never a pre-existing one', () => {
    const style = (id: string): NamedStyle => ({ id, name: id, typography: { fontSize: 10 } });
    const store = new DocumentStore(template({ styles: [style('existing')] }));
    store.dispatch(ensureStyles([style('existing'), style('fresh')]));
    store.undo();
    expect(store.getState().styles.map((s) => s.id)).toEqual(['existing']);
  });

  it('ensureStyles is a no-op when every style is already present', () => {
    const style = (id: string): NamedStyle => ({ id, name: id, typography: { fontSize: 10 } });
    const before = template({ styles: [style('existing')] });
    const cmd = ensureStyles([style('existing')]);
    expect(cmd.apply(before)).toBe(before);
    expect(cmd.invert(before).type).toBe('noop');
  });

  it('ensureDataset declares a path-backed dataset and round-trips', () => {
    const before = template();
    const cmd = ensureDataset('items');
    const after = cmd.apply(before);
    expect(after.datasets).toEqual([{ name: 'items', source: { kind: 'path', path: 'items' } }]);
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });

  it('ensureDataset accepts an explicit source and trims the name', () => {
    const after = ensureDataset('  rows  ', {
      kind: 'expression',
      expr: { source: '$data.rows' },
    }).apply(template());
    expect(after.datasets).toEqual([
      { name: 'rows', source: { kind: 'expression', expr: { source: '$data.rows' } } },
    ]);
  });

  it('ensureDataset ignores an empty name and an already-declared dataset', () => {
    const before = template({
      datasets: [{ name: 'rows', source: { kind: 'path', path: 'rows' } }],
    });
    expect(ensureDataset('   ').apply(before)).toBe(before);
    expect(ensureDataset('rows').apply(before)).toBe(before);
    expect(ensureDataset('rows').invert(before).type).toBe('noop');
  });

  it('replaceTemplate swaps the document as one undoable step', () => {
    const store = new DocumentStore(template());
    const loaded = template({ metadata: { name: 'from gallery' }, bands: [band('only')] });
    store.dispatch(replaceTemplate(loaded));
    expect(store.getState().metadata.name).toBe('from gallery');
    store.undo();
    expect(store.getState().metadata.name).toBe('t');
    expect(bandIds(store.getState())).toEqual(['b1']);
    store.redo();
    expect(store.getState()).toEqual(loaded);
  });
});

describe('the composites the designer builds from these commands', () => {
  it('adding a table wires its styles and dataset in a single undo step', () => {
    const cellStyle: NamedStyle = {
      id: 'tblCell',
      name: 'Table cell',
      typography: { fontFamily: 'Vazirmatn' },
    };
    const store = new DocumentStore(template());
    const before = store.getState();
    const table: TableElement = {
      id: 'tbl',
      type: 'table',
      bounds: { x: 0, y: 0, width: 300, height: 80 },
      zIndex: 1,
      dataset: 'items',
      columns: [{ id: 'c1', width: { kind: 'auto' } }],
    };
    store.dispatch(
      // exactly what dispatchAddElement composes in the designer
      composite([ensureStyles([cellStyle]), ensureDataset(table.dataset), addElement('b1', table)]),
    );
    const after = store.getState();
    expect(after.styles.map((s) => s.id)).toEqual(['tblCell']);
    expect(after.datasets.map((d) => d.name)).toEqual(['items']);
    expect(findElement(after, 'tbl')).toBeDefined();

    store.undo();
    expect(store.getState()).toEqual(before);
    expect(store.canUndo()).toBe(false);
  });
});
