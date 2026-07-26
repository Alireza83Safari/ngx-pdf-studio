/**
 * Saved components ("snippets", §8A-B): capture part of a document as a
 * reusable, self-contained fragment and drop it into any band or container.
 *
 * A snippet is **not** part of a template — it is a library artifact the host
 * app stores wherever it likes (localStorage, a server) and re-inserts later,
 * possibly into a different document. That is why it carries its own copies of
 * the named styles its elements reference: inserting must not depend on the
 * destination already having them.
 *
 * Captured elements are stored relative to the snippet's own top-left, so an
 * insert can place them anywhere, and `insertSnippet` assigns fresh element ids
 * so the same snippet can be inserted many times into one document.
 */
import type { AnyElement } from '../model/elements';
import type { NamedStyle } from '../model/style';
import type { PdfTemplate } from '../model/template';
import type { Command } from './command';
import { composite, addElement, ensureStyles } from './commands';
import { boundingBox, elementChildren, resolveSiblings, translateElement } from './template-ops';

/** A reusable fragment of a document (§8A-B saved components). */
export interface Snippet {
  id: string;
  name: string;
  /** Captured elements, positioned relative to the snippet's top-left. */
  elements: AnyElement[];
  /** Copies of every named style the elements reference, so inserts are self-contained. */
  styles: NamedStyle[];
  /** Bounding size of the capture, in points. */
  width: number;
  height: number;
}

/**
 * Capture elements as a snippet. The ids must be **siblings** — a selection
 * spanning two parents has no single coordinate space — and ids that are missing
 * or live elsewhere are ignored. Returns `undefined` when nothing was captured.
 *
 * Container and list children come along with their parent automatically, since
 * their bounds are already parent-relative.
 */
export function createSnippet(
  template: PdfTemplate,
  elementIds: string[],
  meta: { id: string; name: string },
): Snippet | undefined {
  const members = resolveSiblings(template, elementIds);
  if (members.length === 0) return undefined;
  const box = boundingBox(members.map((m) => m.element.bounds));
  const elements = members.map((m) => translateElement(m.element, -box.x, -box.y));
  const referenced = collectStyleIds(elements);
  return {
    id: meta.id,
    name: meta.name,
    elements,
    styles: template.styles.filter((s) => referenced.has(s.id)),
    width: box.width,
    height: box.height,
  };
}

/**
 * Insert a snippet into `parentId` (a band id, or a container/list id to nest
 * into) as **one** undoable step: its styles are declared first (existing ones
 * are left alone), then its elements land with fresh ids.
 *
 * Ids are `${idPrefix}-${n}` in capture order, which keeps inserts deterministic
 * — pass a prefix that is unique in the destination document.
 */
export function insertSnippet(
  parentId: string,
  snippet: Snippet,
  options: { idPrefix: string; at?: { x: number; y: number }; index?: number },
): Command {
  const { idPrefix, at, index } = options;
  let counter = 0;
  const freshId = (): string => `${idPrefix}-${++counter}`;
  const dx = at?.x ?? 0;
  const dy = at?.y ?? 0;

  const placed = snippet.elements.map((el) => reassignIds(translateElement(el, dx, dy), freshId));
  const adds = placed.map((el, offset) =>
    addElement(parentId, el, index === undefined ? undefined : index + offset),
  );
  return composite([ensureStyles(snippet.styles), ...adds]);
}

/** Every style id referenced anywhere in these elements (including table cells). */
function collectStyleIds(elements: AnyElement[]): Set<string> {
  const ids = new Set<string>();
  const visit = (el: AnyElement): void => {
    if (el.styleId) ids.add(el.styleId);
    if (el.type === 'table') {
      if (el.rowStripeStyleId) ids.add(el.rowStripeStyleId);
      for (const column of el.columns) {
        for (const slot of ['header', 'footer', 'detail'] as const) {
          const cellStyle = column[slot]?.styleId;
          if (cellStyle) ids.add(cellStyle);
        }
      }
    }
    for (const child of elementChildren(el) ?? []) visit(child);
  };
  elements.forEach(visit);
  return ids;
}

/** Give an element and its whole subtree fresh ids. */
function reassignIds(element: AnyElement, freshId: () => string): AnyElement {
  const next = { ...element, id: freshId() } as AnyElement;
  const children = elementChildren(next);
  if (!children) return next;
  const rebuilt = children.map((child) => reassignIds(child, freshId));
  if (next.type === 'container') return { ...next, children: rebuilt };
  if (next.type === 'list') return { ...next, itemTemplate: rebuilt };
  return next;
}
