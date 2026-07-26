/**
 * Saved components (§8A-B). A snippet must be self-contained — it carries the
 * styles its elements reference — and insertable repeatedly into one document,
 * which means fresh element ids every time.
 */
import { layoutDocument } from '../render';
import type { AnyElement, ContainerElement, TableElement } from '../model/elements';
import type { NamedStyle } from '../model/style';
import type { PdfTemplate } from '../model/template';
import { DocumentStore } from './document-store';
import { createSnippet, insertSnippet } from './snippet';
import { findElement } from './template-ops';

const style = (id: string): NamedStyle => ({ id, name: id, typography: { fontSize: 10 } });

const text = (id: string, x: number, y: number, styleId?: string): AnyElement => ({
  id,
  type: 'staticText',
  bounds: { x, y, width: 40, height: 20 },
  zIndex: 1,
  text: id,
  ...(styleId ? { styleId } : {}),
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
    bands: [
      { id: 'b1', type: 'reportHeader', height: { mode: 'fixed', value: 300 }, elements },
      { id: 'b2', type: 'detail', height: { mode: 'fixed', value: 40 }, elements: [] },
    ],
    resources: { fonts: [], images: [] },
  };
}

/** A letterhead-ish trio at (20,20)–(140,90) using one shared style. */
const source = (): PdfTemplate =>
  template(
    [style('brand'), style('unused')],
    [text('logo', 20, 20, 'brand'), text('name', 70, 20, 'brand'), text('rule', 20, 70)],
  );

const meta = { id: 'snip-1', name: 'سربرگ' };

describe('createSnippet', () => {
  it('captures the elements relative to their own bounding box', () => {
    const snippet = createSnippet(source(), ['logo', 'name', 'rule'], meta)!;
    expect({ width: snippet.width, height: snippet.height }).toEqual({ width: 90, height: 70 });
    expect(snippet.elements.map((e) => [e.id, e.bounds.x, e.bounds.y])).toEqual([
      ['logo', 0, 0],
      ['name', 50, 0],
      ['rule', 0, 50],
    ]);
  });

  it('carries only the styles its elements actually reference', () => {
    const snippet = createSnippet(source(), ['logo', 'rule'], meta)!;
    expect(snippet.styles.map((s) => s.id)).toEqual(['brand']);
  });

  it('collects styles from nested children and from table cells', () => {
    const table: TableElement = {
      id: 'tbl',
      type: 'table',
      bounds: { x: 0, y: 0, width: 200, height: 60 },
      zIndex: 1,
      dataset: 'rows',
      rowStripeStyleId: 'stripe',
      columns: [
        {
          id: 'c1',
          width: { kind: 'auto' },
          header: { text: 'A', styleId: 'head' },
          detail: { content: { source: 'row.a' }, styleId: 'cell' },
        },
      ],
    };
    const container: ContainerElement = {
      id: 'grp',
      type: 'container',
      bounds: { x: 0, y: 100, width: 200, height: 60 },
      zIndex: 1,
      children: [text('inner', 0, 0, 'deepStyle')],
    };
    const t = template(
      [style('head'), style('cell'), style('stripe'), style('deepStyle'), style('nope')],
      [table, container],
    );
    const snippet = createSnippet(t, ['tbl', 'grp'], meta)!;
    expect(snippet.styles.map((s) => s.id).sort()).toEqual(['cell', 'deepStyle', 'head', 'stripe']);
  });

  it('ignores unknown ids and refuses to mix parents', () => {
    const t = template([], [text('a', 0, 0), text('b', 50, 0)]);
    const withGhost = createSnippet(t, ['a', 'ghost', 'b'], meta)!;
    expect(withGhost.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(createSnippet(t, ['ghost'], meta)).toBeUndefined();
    expect(createSnippet(t, [], meta)).toBeUndefined();
  });

  it('captures a single element too (one saved component, not a selection)', () => {
    const snippet = createSnippet(source(), ['logo'], meta)!;
    expect(snippet.elements.map((e) => e.id)).toEqual(['logo']);
    expect({ width: snippet.width, height: snippet.height }).toEqual({ width: 40, height: 20 });
  });
});

describe('insertSnippet', () => {
  const blank = (): PdfTemplate => template([], []);
  const snippet = (): ReturnType<typeof createSnippet> =>
    createSnippet(source(), ['logo', 'name', 'rule'], meta);

  it('lands the elements with fresh ids and declares the styles, in one step', () => {
    const store = new DocumentStore(blank());
    const before = store.getState();
    store.dispatch(insertSnippet('b1', snippet()!, { idPrefix: 'ins1' }));
    const after = store.getState();
    expect(after.bands[0]!.elements.map((e) => e.id)).toEqual(['ins1-1', 'ins1-2', 'ins1-3']);
    expect(after.styles.map((s) => s.id)).toEqual(['brand']);
    // …and it is exactly one undo
    store.undo();
    expect(store.getState()).toEqual(before);
    expect(store.canUndo()).toBe(false);
  });

  it('places the snippet at a position, keeping the internal layout', () => {
    const after = insertSnippet('b1', snippet()!, { idPrefix: 'i', at: { x: 100, y: 200 } }).apply(
      blank(),
    );
    expect(after.bands[0]!.elements.map((e) => [e.bounds.x, e.bounds.y])).toEqual([
      [100, 200],
      [150, 200],
      [100, 250],
    ]);
  });

  it('can be inserted twice into the same document without id collisions', () => {
    const store = new DocumentStore(blank());
    const s = snippet()!;
    store.dispatch(insertSnippet('b1', s, { idPrefix: 'a' }));
    store.dispatch(insertSnippet('b1', s, { idPrefix: 'b', at: { x: 0, y: 150 } }));
    const ids = store.getState().bands[0]!.elements.map((e) => e.id);
    expect(ids).toEqual(['a-1', 'a-2', 'a-3', 'b-1', 'b-2', 'b-3']);
    expect(new Set(ids).size).toBe(ids.length);
    // the second insert must not re-add the style
    expect(store.getState().styles.map((s2) => s2.id)).toEqual(['brand']);
  });

  it('gives nested children fresh ids as well', () => {
    const t = template(
      [],
      [
        {
          id: 'grp',
          type: 'container',
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          zIndex: 1,
          children: [text('c1', 0, 0), text('c2', 0, 30)],
        },
      ],
    );
    const s = createSnippet(t, ['grp'], meta)!;
    const after = insertSnippet('b1', s, { idPrefix: 'n' }).apply(blank());
    const group = after.bands[0]!.elements[0] as ContainerElement;
    expect(group.id).toBe('n-1');
    expect(group.children.map((c) => c.id)).toEqual(['n-2', 'n-3']);
  });

  it('nests into a container when given one as the parent', () => {
    const dest = template(
      [],
      [
        {
          id: 'host',
          type: 'container',
          bounds: { x: 10, y: 10, width: 300, height: 300 },
          zIndex: 1,
          children: [],
        },
      ],
    );
    const after = insertSnippet('host', snippet()!, { idPrefix: 'h' }).apply(dest);
    expect(findElement(after, 'h-1')).toMatchObject({ parentId: 'host' });
  });

  it('inserts at an index, preserving snippet order', () => {
    const dest = template([], [text('first', 0, 0), text('last', 0, 200)]);
    const after = insertSnippet('b1', snippet()!, { idPrefix: 'm', index: 1 }).apply(dest);
    expect(after.bands[0]!.elements.map((e) => e.id)).toEqual([
      'first',
      'm-1',
      'm-2',
      'm-3',
      'last',
    ]);
  });

  it('capture then insert at the original spot reproduces the same geometry', () => {
    const original = source();
    const s = createSnippet(original, ['logo', 'name', 'rule'], meta)!;
    // start from the same document with those three removed, then re-insert
    const emptied = template(original.styles, []);
    const restored = insertSnippet('b1', s, { idPrefix: 'r', at: { x: 20, y: 20 } }).apply(emptied);
    const geometry = (t: PdfTemplate): unknown =>
      layoutDocument(t, {})
        .pages.flatMap((p) => p.elements)
        .map((e) => [e.bounds.x, e.bounds.y, e.bounds.width, e.bounds.height]);
    expect(geometry(restored)).toEqual(geometry(original));
  });
});
