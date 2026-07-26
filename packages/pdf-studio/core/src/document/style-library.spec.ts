/**
 * The style library (§8A-B): edit a named style once and every element using it
 * follows. Deleting one must not leave dangling references — a missed style
 * lookup silently falls back to defaults, with no diagnostic.
 */
import type { AnyElement, TableElement } from '../model/elements';
import type { NamedStyle } from '../model/style';
import type { PdfTemplate } from '../model/template';
import { addStyle, duplicateStyle, removeStyle, updateStyle } from './commands';
import { DocumentStore } from './document-store';
import { findElement } from './template-ops';

const style = (id: string, name = id): NamedStyle => ({
  id,
  name,
  typography: { fontSize: 10 },
});

const text = (id: string, styleId?: string): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x: 0, y: 0, width: 40, height: 20 },
  zIndex: 1,
  text: id,
  ...(styleId ? { styleId } : {}),
});

/** A table wired the way the designer wires one: cell + header + stripe styles. */
const table = (): TableElement => ({
  id: 'tbl',
  type: 'table',
  bounds: { x: 0, y: 40, width: 300, height: 80 },
  zIndex: 1,
  dataset: 'rows',
  rowStripeStyleId: 'stripe',
  columns: [
    {
      id: 'c1',
      width: { kind: 'auto' },
      header: { text: 'A', styleId: 'tblHead' },
      detail: { content: { source: 'row.a' }, styleId: 'tblCell' },
    },
    {
      id: 'c2',
      width: { kind: 'auto' },
      header: { text: 'B', styleId: 'tblHead' },
      detail: { content: { source: 'row.b' }, styleId: 'other' },
    },
  ],
});

function template(styles: NamedStyle[], elements: AnyElement[]): PdfTemplate {
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
    styles,
    datasets: [],
    parameters: [],
    bands: [{ id: 'b1', type: 'reportHeader', height: { mode: 'fixed', value: 200 }, elements }],
    resources: { fonts: [], images: [] },
  };
}

const styleIds = (t: PdfTemplate): string[] => t.styles.map((s) => s.id);
const tableOf = (t: PdfTemplate): TableElement => findElement(t, 'tbl')!.element as TableElement;

describe('addStyle / updateStyle / duplicateStyle', () => {
  it('addStyle appends and undo removes it again', () => {
    const store = new DocumentStore(template([style('a')], []));
    store.dispatch(addStyle(style('b')));
    expect(styleIds(store.getState())).toEqual(['a', 'b']);
    store.undo();
    expect(styleIds(store.getState())).toEqual(['a']);
  });

  it('addStyle is a no-op for an id that already exists', () => {
    const before = template([style('a')], []);
    const cmd = addStyle(style('a', 'different name'));
    expect(cmd.apply(before)).toBe(before);
    expect(cmd.invert(before).type).toBe('noop');
  });

  it('updateStyle round-trips, restoring only the patched keys', () => {
    const store = new DocumentStore(template([style('a'), style('b')], []));
    const before = store.getState();
    store.dispatch(updateStyle('a', { name: 'renamed', typography: { fontSize: 24 } }));
    expect(store.getState().styles[0]).toEqual({
      id: 'a',
      name: 'renamed',
      typography: { fontSize: 24 },
    });
    expect(store.getState().styles[1]).toBe(before.styles[1]); // untouched
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('editing a style reaches every element referencing it, with no element edits', () => {
    const before = template([style('shared')], [text('x', 'shared'), text('y', 'shared')]);
    const after = updateStyle('shared', { typography: { fontSize: 30 } }).apply(before);
    // the elements are untouched — they resolve through the style at render time
    expect(after.bands[0]!.elements).toBe(before.bands[0]!.elements);
    expect(after.styles[0]!.typography).toEqual({ fontSize: 30 });
  });

  it('updateStyle on an unknown id changes nothing', () => {
    const before = template([style('a')], []);
    expect(updateStyle('nope', { name: 'x' }).apply(before)).toBe(before);
    expect(updateStyle('nope', { name: 'x' }).invert(before).type).toBe('noop');
  });

  it('duplicateStyle copies under a new id, optionally renaming', () => {
    const after = duplicateStyle('a', 'a-copy', 'Variant').apply(template([style('a')], []));
    expect(after.styles).toEqual([
      { id: 'a', name: 'a', typography: { fontSize: 10 } },
      { id: 'a-copy', name: 'Variant', typography: { fontSize: 10 } },
    ]);
  });

  it('duplicateStyle keeps the original name when none is given, and round-trips', () => {
    const store = new DocumentStore(template([style('a', 'Heading')], []));
    const before = store.getState();
    store.dispatch(duplicateStyle('a', 'a2'));
    expect(store.getState().styles[1]).toMatchObject({ id: 'a2', name: 'Heading' });
    store.undo();
    expect(store.getState()).toEqual(before);
  });

  it('duplicateStyle is a no-op for an unknown source or a taken target', () => {
    const before = template([style('a'), style('b')], []);
    expect(duplicateStyle('nope', 'x').apply(before)).toBe(before);
    expect(duplicateStyle('a', 'b').apply(before)).toBe(before);
    expect(duplicateStyle('nope', 'x').invert(before).type).toBe('noop');
  });
});

describe('removeStyle drops the style and every reference to it', () => {
  it('clears styleId on referencing elements, at any depth', () => {
    const before = template(
      [style('gone'), style('kept')],
      [
        text('a', 'gone'),
        text('b', 'kept'),
        {
          id: 'grp',
          type: 'container',
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          zIndex: 1,
          children: [text('deep', 'gone')],
        },
      ],
    );
    const after = removeStyle('gone').apply(before);
    expect(styleIds(after)).toEqual(['kept']);
    expect(findElement(after, 'a')!.element.styleId).toBeUndefined();
    expect(findElement(after, 'deep')!.element.styleId).toBeUndefined();
    expect(findElement(after, 'b')!.element.styleId).toBe('kept'); // untouched
  });

  it('clears table cell styles and the row-stripe style', () => {
    const before = template([style('tblHead'), style('tblCell'), style('stripe')], [table()]);

    const noHead = tableOf(removeStyle('tblHead').apply(before));
    expect(noHead.columns[0]!.header!.styleId).toBeUndefined();
    expect(noHead.columns[1]!.header!.styleId).toBeUndefined();
    expect(noHead.columns[0]!.detail!.styleId).toBe('tblCell'); // other slots intact
    expect(noHead.rowStripeStyleId).toBe('stripe');

    const noStripe = tableOf(removeStyle('stripe').apply(before));
    expect(noStripe.rowStripeStyleId).toBeUndefined();
    expect(noStripe.columns[0]!.header!.styleId).toBe('tblHead');
  });

  it('deletes the properties rather than setting them to undefined', () => {
    const after = removeStyle('gone').apply(template([style('gone')], [text('a', 'gone')]));
    expect('styleId' in (findElement(after, 'a')!.element as object)).toBe(false);
  });

  it('leaves elements alone when they reference nothing removed', () => {
    const before = template([style('gone'), style('kept')], [text('a', 'kept')]);
    const after = removeStyle('gone').apply(before);
    // structural sharing: no element was rewritten
    expect(after.bands[0]!.elements).toBe(before.bands[0]!.elements);
  });

  it('undo restores the style and every reference it cleared, in one step', () => {
    const store = new DocumentStore(
      template(
        [style('tblHead'), style('tblCell'), style('stripe')],
        [table(), text('a', 'stripe')],
      ),
    );
    const before = store.getState();
    store.dispatch(removeStyle('stripe'));
    expect(styleIds(store.getState())).toEqual(['tblHead', 'tblCell']);
    store.undo();
    expect(store.getState()).toEqual(before);
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect(findElement(store.getState(), 'a')!.element.styleId).toBeUndefined();
  });

  it('is a no-op for an unknown style id', () => {
    const before = template([style('a')], [text('x', 'a')]);
    expect(removeStyle('nope').apply(before)).toBe(before);
    expect(removeStyle('nope').invert(before).type).toBe('noop');
  });
});
