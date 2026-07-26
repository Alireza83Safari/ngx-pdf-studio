/**
 * Document sections (§11A-E): parts of one document with their own page setup.
 * The layout engine renders them in order and ignores top-level `bands` when any
 * exist, so nothing in a sectioned document may be invisible to the editing
 * layer — every element and band lookup has to reach inside.
 */
import { layoutDocument } from '../render';
import type { Band } from '../model/band';
import type { AnyElement } from '../model/elements';
import type { PageSetup } from '../model/page';
import type { PdfTemplate, TemplateSection } from '../model/template';
import {
  addBand,
  addSection,
  moveBand,
  moveSection,
  patchBand,
  patchElement,
  patchSection,
  removeBandById,
  removeElementById,
  removeSectionById,
  setElementBounds,
  moveElementZ,
} from './commands';
import { DocumentStore } from './document-store';
import { findBand, findElement, insertElement, updateElement } from './template-ops';

const page = (overrides: Partial<PageSetup> = {}): PageSetup => ({
  size: 'A4',
  orientation: 'portrait',
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  direction: 'ltr',
  locale: { language: 'en', digits: 'latn', calendar: 'gregorian' },
  unit: 'pt',
  ...overrides,
});

const el = (id: string, zIndex = 1): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x: 10, y: 10, width: 50, height: 20 },
  zIndex,
  text: id,
});

const band = (id: string, elements: AnyElement[] = []): Band => ({
  id,
  type: 'reportHeader',
  height: { mode: 'fixed', value: 100 },
  elements,
});

/**
 * A two-section document: a portrait cover and a landscape appendix, with the
 * top-level `bands` left non-empty on purpose — the engine ignores it here, and
 * the ops must not confuse the two lists.
 */
function sectioned(): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
    page: page(),
    styles: [],
    datasets: [],
    parameters: [],
    bands: [band('topLevel', [el('ignored')])],
    sections: [
      { id: 's1', page: page(), bands: [band('coverBand', [el('cover')])] },
      {
        id: 's2',
        page: page({ orientation: 'landscape' }),
        bands: [band('appendixBand', [el('appendix')]), band('appendixTwo')],
        restartPageNumbers: true,
      },
    ],
    resources: { fonts: [], images: [] },
  };
}

const sectionIds = (t: PdfTemplate): string[] => (t.sections ?? []).map((s) => s.id);
const bandIdsIn = (t: PdfTemplate, i: number): string[] =>
  (t.sections?.[i]?.bands ?? []).map((b) => b.id);

describe('element lookups reach into sections', () => {
  it('findElement reports the section holding the element', () => {
    expect(findElement(sectioned(), 'cover')).toMatchObject({
      bandId: 'coverBand',
      bandIndex: 0,
      sectionIndex: 0,
    });
    expect(findElement(sectioned(), 'appendix')).toMatchObject({
      bandId: 'appendixBand',
      sectionIndex: 1,
    });
  });

  it('omits sectionIndex for a top-level element', () => {
    const loc = findElement(sectioned(), 'ignored')!;
    expect(loc.bandId).toBe('topLevel');
    expect('sectionIndex' in loc).toBe(false);
  });

  it('updateElement and removeElement edit inside a section', () => {
    const updated = updateElement(sectioned(), 'appendix', (e) => ({ ...e, zIndex: 9 }));
    expect(findElement(updated, 'appendix')!.element.zIndex).toBe(9);
    expect(findElement(updated, 'cover')!.element.zIndex).toBe(1);
  });

  it('insertElement targets a band inside a section by id', () => {
    const next = insertElement(sectioned(), 'appendixTwo', el('fresh'));
    expect(findElement(next, 'fresh')).toMatchObject({
      bandId: 'appendixTwo',
      sectionIndex: 1,
    });
  });

  it('keeps untouched sections referentially identical', () => {
    const before = sectioned();
    const after = updateElement(before, 'appendix', (e) => ({ ...e, zIndex: 5 }));
    expect(after.sections![0]).toBe(before.sections![0]);
    expect(after.bands).toBe(before.bands);
    expect(after.sections![1]).not.toBe(before.sections![1]);
  });

  it('returns the same template when nothing matches', () => {
    const before = sectioned();
    expect(updateElement(before, 'nope', (e) => e)).toBe(before);
    expect(insertElement(before, 'nope', el('x'))).toBe(before);
  });
});

describe('element commands work inside a section', () => {
  it('patchElement round-trips on a sectioned element', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(patchElement('appendix', { zIndex: 7 }));
    expect(findElement(store.getState(), 'appendix')!.element.zIndex).toBe(7);
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('setElementBounds round-trips on a sectioned element', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(setElementBounds('cover', { x: 1, y: 2, width: 3, height: 4 }));
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('removeElementById restores a sectioned element to its own band', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(removeElementById('appendix'));
    expect(findElement(store.getState(), 'appendix')).toBeUndefined();
    store.undo();
    expect(findElement(store.getState(), 'appendix')).toMatchObject({
      bandId: 'appendixBand',
      sectionIndex: 1,
    });
    expect(store.getState()).toEqual(before);
  });

  it('moveElementZ compares against siblings in the same sectioned band', () => {
    const t: PdfTemplate = {
      ...sectioned(),
      // the top-level band has a huge z that must not influence the section
      bands: [band('topLevel', [el('ignored', 500)])],
    };
    const withTwo = insertElement(t, 'appendixBand', el('sibling', 2));
    const after = moveElementZ('appendix', 'front').apply(withTwo);
    expect(findElement(after, 'appendix')!.element.zIndex).toBe(3);
  });
});

describe('band commands work inside a section', () => {
  it('findBand locates bands at both levels', () => {
    expect(findBand(sectioned(), 'topLevel')).toMatchObject({ index: 0 });
    expect('sectionIndex' in findBand(sectioned(), 'topLevel')!).toBe(false);
    expect(findBand(sectioned(), 'appendixTwo')).toMatchObject({ index: 1, sectionIndex: 1 });
    expect(findBand(sectioned(), 'nope')).toBeUndefined();
  });

  it('patchBand edits a section band and round-trips', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(patchBand('appendixTwo', { type: 'detail', dataset: 'rows' }));
    expect(store.getState().sections![1]!.bands[1]).toMatchObject({
      type: 'detail',
      dataset: 'rows',
    });
    expect(store.getState().bands).toBe(before.bands); // top level untouched
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('addBand can target a section, and undo removes it from there', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(addBand(band('extra'), undefined, 1));
    expect(bandIdsIn(store.getState(), 1)).toEqual(['appendixBand', 'appendixTwo', 'extra']);
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('removeBandById restores a section band to its own section and position', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(removeBandById('appendixBand'));
    expect(bandIdsIn(store.getState(), 1)).toEqual(['appendixTwo']);
    store.undo();
    expect(bandIdsIn(store.getState(), 1)).toEqual(['appendixBand', 'appendixTwo']);
    expect(store.getState()).toEqual(before);
  });

  it('moveBand reorders within one section only', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(moveBand(1, 0, 1));
    expect(bandIdsIn(store.getState(), 1)).toEqual(['appendixTwo', 'appendixBand']);
    expect(bandIdsIn(store.getState(), 0)).toEqual(['coverBand']);
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('a band command with an out-of-range section is a safe no-op', () => {
    const before = sectioned();
    expect(addBand(band('x'), 0, 99).apply(before)).toBe(before);
    expect(moveBand(0, 1, 99).apply(before)).toBe(before);
  });
});

describe('section commands', () => {
  it('addSection appends and undo removes it', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    const extra: TemplateSection = { id: 's3', page: page(), bands: [band('b3')] };
    store.dispatch(addSection(extra));
    expect(sectionIds(store.getState())).toEqual(['s1', 's2', 's3']);
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('addSection creates the list on a template that has none', () => {
    // build it without `sections` at all — `exactOptionalPropertyTypes` rejects
    // an explicit `sections: undefined`, and the point is the absent-key case
    const flat: PdfTemplate = { ...sectioned() };
    delete flat.sections;
    const after = addSection({ id: 'first', page: page(), bands: [] }).apply(flat);
    expect(sectionIds(after)).toEqual(['first']);
  });

  it('addSection inserts at an index, clamping out-of-range values', () => {
    const s: TemplateSection = { id: 'mid', page: page(), bands: [] };
    expect(sectionIds(addSection(s, 0).apply(sectioned()))).toEqual(['mid', 's1', 's2']);
    expect(sectionIds(addSection(s, 99).apply(sectioned()))).toEqual(['s1', 's2', 'mid']);
  });

  it('removeSectionById takes its bands with it, and undo restores the position', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(removeSectionById('s1'));
    expect(sectionIds(store.getState())).toEqual(['s2']);
    expect(findElement(store.getState(), 'cover')).toBeUndefined();
    store.undo();
    expect(sectionIds(store.getState())).toEqual(['s1', 's2']);
    expect(store.getState()).toEqual(before);
  });

  it('patchSection changes a section page setup and round-trips', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(patchSection('s1', { page: page({ size: 'A5' }), restartPageNumbers: true }));
    expect(store.getState().sections![0]!.page.size).toBe('A5');
    expect(store.getState().sections![0]!.bands).toBe(before.sections![0]!.bands); // bands untouched
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('moveSection reorders the document and round-trips', () => {
    const store = new DocumentStore(sectioned());
    const before = store.getState();
    store.dispatch(moveSection(1, 0));
    expect(sectionIds(store.getState())).toEqual(['s2', 's1']);
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('section commands on unknown ids are safe no-ops', () => {
    const before = sectioned();
    expect(removeSectionById('nope').apply(before)).toBe(before);
    expect(patchSection('nope', { restartPageNumbers: true }).apply(before)).toBe(before);
    expect(moveSection(9, 0).apply(before)).toBe(before);
    expect(removeSectionById('nope').invert(before).type).toBe('noop');
    expect(patchSection('nope', {}).invert(before).type).toBe('noop');
  });
});

describe('the edits actually reach the rendered document', () => {
  it('an edit inside a section changes what that section paints', () => {
    const before = sectioned();
    const after = patchElement('appendix', {
      bounds: { x: 99, y: 99, width: 50, height: 20 },
    }).apply(before);
    const xOf = (t: PdfTemplate): number[] =>
      layoutDocument(t, {})
        .pages.flatMap((p) => p.elements)
        .filter((e) => e.id === 'appendix')
        .map((e) => e.bounds.x);
    expect(xOf(before)).toEqual([10]);
    expect(xOf(after)).toEqual([99]);
  });

  it('reordering sections reorders the pages, keeping each page setup', () => {
    const isLandscape = (t: PdfTemplate): boolean[] =>
      layoutDocument(t, {}).pages.map((p) => p.size.width > p.size.height);
    // portrait cover, then landscape appendix
    expect(isLandscape(sectioned())).toEqual([false, true]);
    // swap them and the page setups travel with their sections
    expect(isLandscape(moveSection(1, 0).apply(sectioned()))).toEqual([true, false]);
  });
});
