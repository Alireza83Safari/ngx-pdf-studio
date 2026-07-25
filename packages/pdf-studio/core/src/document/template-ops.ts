/**
 * Immutable operations on a {@link PdfTemplate} used by editor commands (§8).
 * Every function returns a new template with **structural sharing** — only the
 * objects on the path to the change are cloned; everything else is referenced —
 * so undo/redo snapshots stay cheap and the template tree is never mutated in
 * place (the §8 "never mutate the tree directly" rule, enforced by construction).
 *
 * All lookups are **recursive**: elements nested inside a `container`'s children
 * or a `list`'s item template are reachable exactly like top-level band
 * elements, which is what makes group/ungroup and nested editing possible. As in
 * the layout engine, a nested element's `bounds` are **relative to its parent's
 * top-left**, not to the band.
 */
import type { AnyElement } from '../model/elements';
import type { PageSetup } from '../model/page';
import type { PdfTemplate } from '../model/template';

export interface ElementLocation {
  /** Band the element ultimately lives in, at any nesting depth. */
  bandId: string;
  bandIndex: number;
  /** Index within the **immediate** parent's child list. */
  index: number;
  element: AnyElement;
  /**
   * Ids of the nesting elements from the band down to the immediate parent —
   * empty when the element is a direct child of the band.
   */
  containerPath: string[];
  /**
   * The immediate parent to insert siblings into: the innermost container id,
   * or the band id for a top-level element. Accepted by {@link insertElement}.
   */
  parentId: string;
}

/**
 * The child elements a composite element owns, or `undefined` for leaves.
 * Containers nest arbitrarily; a list's item template is the sub-layout it
 * repeats per row (§5). Both are edited through the same recursive path.
 */
export function elementChildren(element: AnyElement): AnyElement[] | undefined {
  if (element.type === 'container') return element.children;
  if (element.type === 'list') return element.itemTemplate;
  return undefined;
}

/** Replace a composite element's children; leaves are returned untouched. */
function withChildren(element: AnyElement, children: AnyElement[]): AnyElement {
  if (element.type === 'container') return { ...element, children };
  if (element.type === 'list') return { ...element, itemTemplate: children };
  return element;
}

interface LocalHit {
  index: number;
  element: AnyElement;
  containerPath: string[];
}

function search(elements: AnyElement[], elementId: string, path: string[]): LocalHit | undefined {
  const index = elements.findIndex((el) => el.id === elementId);
  if (index >= 0) {
    return { index, element: elements[index] as AnyElement, containerPath: path };
  }
  for (const el of elements) {
    const children = elementChildren(el);
    if (!children) continue;
    const hit = search(children, elementId, [...path, el.id]);
    if (hit) return hit;
  }
  return undefined;
}

/** Locate an element by id, at any nesting depth. */
export function findElement(template: PdfTemplate, elementId: string): ElementLocation | undefined {
  for (let bandIndex = 0; bandIndex < template.bands.length; bandIndex++) {
    const band = template.bands[bandIndex];
    if (!band) continue;
    const hit = search(band.elements, elementId, []);
    if (!hit) continue;
    const { containerPath } = hit;
    return {
      bandId: band.id,
      bandIndex,
      index: hit.index,
      element: hit.element,
      containerPath,
      parentId: containerPath[containerPath.length - 1] ?? band.id,
    };
  }
  return undefined;
}

/**
 * Recursively rewrite the child list that **directly contains** `elementId`.
 * Returns the identical array reference when the id is absent, so untouched
 * bands and subtrees keep their identity (structural sharing).
 */
function transformOwner(
  elements: AnyElement[],
  elementId: string,
  transform: (siblings: AnyElement[]) => AnyElement[],
): AnyElement[] {
  if (elements.some((el) => el.id === elementId)) return transform(elements);
  let changed = false;
  const next = elements.map((el) => {
    if (changed) return el; // ids are unique — at most one subtree changes
    const children = elementChildren(el);
    if (!children) return el;
    const nextChildren = transformOwner(children, elementId, transform);
    if (nextChildren === children) return el;
    changed = true;
    return withChildren(el, nextChildren);
  });
  return changed ? next : elements;
}

/**
 * Recursively rewrite the children of the composite element `parentId`.
 * Returns the identical array reference when no such parent exists.
 */
function transformChildrenOf(
  elements: AnyElement[],
  parentId: string,
  transform: (children: AnyElement[]) => AnyElement[],
): AnyElement[] {
  let changed = false;
  const next = elements.map((el) => {
    if (changed) return el;
    const children = elementChildren(el);
    if (!children) return el;
    if (el.id === parentId) {
      changed = true;
      return withChildren(el, transform(children));
    }
    const nextChildren = transformChildrenOf(children, parentId, transform);
    if (nextChildren === children) return el;
    changed = true;
    return withChildren(el, nextChildren);
  });
  return changed ? next : elements;
}

/** Apply `transform` to every band's element list, keeping unchanged bands identical. */
function mapBands(
  template: PdfTemplate,
  transform: (elements: AnyElement[]) => AnyElement[],
): PdfTemplate {
  let changed = false;
  const bands = template.bands.map((band) => {
    const next = transform(band.elements);
    if (next === band.elements) return band;
    changed = true;
    return { ...band, elements: next };
  });
  return changed ? { ...template, bands } : template;
}

/** Replace an element (matched by id, at any depth) via `updater`. */
export function updateElement(
  template: PdfTemplate,
  elementId: string,
  updater: (element: AnyElement) => AnyElement,
): PdfTemplate {
  return mapBands(template, (elements) =>
    transformOwner(elements, elementId, (siblings) =>
      siblings.map((el) => (el.id === elementId ? updater(el) : el)),
    ),
  );
}

/**
 * Insert an element into a parent at `index` (default: end). `parentId` is
 * either a band id (top-level) or the id of a `container`/`list` to nest into —
 * exactly what {@link ElementLocation.parentId} reports, so undo can restore an
 * element to wherever it came from. Bands are resolved first.
 */
export function insertElement(
  template: PdfTemplate,
  parentId: string,
  element: AnyElement,
  index?: number,
): PdfTemplate {
  const insert = (siblings: AnyElement[]): AnyElement[] => {
    const at =
      index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
    return [...siblings.slice(0, at), element, ...siblings.slice(at)];
  };
  const bandIndex = template.bands.findIndex((b) => b.id === parentId);
  if (bandIndex >= 0) {
    const band = template.bands[bandIndex];
    if (!band) return template;
    const bands = template.bands.slice();
    bands[bandIndex] = { ...band, elements: insert(band.elements) };
    return { ...template, bands };
  }
  return mapBands(template, (elements) => transformChildrenOf(elements, parentId, insert));
}

/** Remove an element (matched by id, at any depth) from its parent. */
export function removeElement(template: PdfTemplate, elementId: string): PdfTemplate {
  return mapBands(template, (elements) =>
    transformOwner(elements, elementId, (siblings) => siblings.filter((el) => el.id !== elementId)),
  );
}

/** Shallow-merge a patch into the page setup. */
export function patchPage(template: PdfTemplate, patch: Partial<PageSetup>): PdfTemplate {
  return { ...template, page: { ...template.page, ...patch } };
}
