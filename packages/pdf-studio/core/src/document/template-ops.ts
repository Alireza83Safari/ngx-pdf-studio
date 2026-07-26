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
 *
 * They also reach **into `template.sections`** (§11A-E), whose bands the layout
 * engine renders with their own page setup. Nothing in the model should be
 * invisible to the command layer; top-level `bands` are searched first, so an id
 * collision resolves the same way it always did.
 */
import type { Band } from '../model/band';
import type { AnyElement } from '../model/elements';
import type { PageSetup } from '../model/page';
import type { PdfTemplate } from '../model/template';
import type { Rect } from '../model/units';

export interface ElementLocation {
  /** Band the element ultimately lives in, at any nesting depth. */
  bandId: string;
  /** Index of the band **within its own list** (top-level or a section's). */
  bandIndex: number;
  /** Section holding the band, or `undefined` for a top-level band. */
  sectionIndex?: number;
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

/** Where a band lives — top-level, or inside a document section (§11A-E). */
export interface BandLocation {
  band: Band;
  /** Index within its own list. */
  index: number;
  /** Section holding it, or `undefined` when top-level. */
  sectionIndex?: number;
}

/**
 * Put `band` back where `at` came from — the one place that knows whether a band
 * lives in `template.bands` or inside a section, so callers do not repeat it.
 */
export function replaceBand(template: PdfTemplate, at: BandLocation, band: Band): PdfTemplate {
  if (at.sectionIndex === undefined) {
    const bands = template.bands.slice();
    bands[at.index] = band;
    return { ...template, bands };
  }
  const sections = (template.sections ?? []).slice();
  const section = sections[at.sectionIndex];
  if (!section) return template;
  const bands = section.bands.slice();
  bands[at.index] = band;
  sections[at.sectionIndex] = { ...section, bands };
  return { ...template, sections };
}

/** Locate a band by id, in `template.bands` first, then in every section. */
export function findBand(template: PdfTemplate, bandId: string): BandLocation | undefined {
  const top = template.bands.findIndex((b) => b.id === bandId);
  if (top >= 0) return { band: template.bands[top] as Band, index: top };
  const sections = template.sections ?? [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const bands = sections[sectionIndex]?.bands ?? [];
    const index = bands.findIndex((b) => b.id === bandId);
    if (index >= 0) return { band: bands[index] as Band, index, sectionIndex };
  }
  return undefined;
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

/** Locate an element by id, at any nesting depth, in any band of any section. */
export function findElement(template: PdfTemplate, elementId: string): ElementLocation | undefined {
  const scan = (bands: Band[], sectionIndex?: number): ElementLocation | undefined => {
    for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
      const band = bands[bandIndex];
      if (!band) continue;
      const hit = search(band.elements, elementId, []);
      if (!hit) continue;
      const { containerPath } = hit;
      return {
        bandId: band.id,
        bandIndex,
        ...(sectionIndex === undefined ? {} : { sectionIndex }),
        index: hit.index,
        element: hit.element,
        containerPath,
        parentId: containerPath[containerPath.length - 1] ?? band.id,
      };
    }
    return undefined;
  };

  const top = scan(template.bands);
  if (top) return top;
  const sections = template.sections ?? [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const hit = scan(sections[sectionIndex]?.bands ?? [], sectionIndex);
    if (hit) return hit;
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

/**
 * Apply `transform` to the element list of **every** band — top-level and inside
 * every section — keeping unchanged bands, sections and the template itself
 * referentially identical.
 */
function mapBands(
  template: PdfTemplate,
  transform: (elements: AnyElement[]) => AnyElement[],
): PdfTemplate {
  const mapList = (bands: Band[]): Band[] => {
    let changed = false;
    const next = bands.map((band) => {
      const elements = transform(band.elements);
      if (elements === band.elements) return band;
      changed = true;
      return { ...band, elements };
    });
    return changed ? next : bands;
  };

  const bands = mapList(template.bands);
  const sections = template.sections;
  if (!sections) return bands === template.bands ? template : { ...template, bands };

  let sectionsChanged = false;
  const nextSections = sections.map((section) => {
    const mapped = mapList(section.bands);
    if (mapped === section.bands) return section;
    sectionsChanged = true;
    return { ...section, bands: mapped };
  });
  if (bands === template.bands && !sectionsChanged) return template;
  return { ...template, bands, ...(sectionsChanged ? { sections: nextSections } : {}) };
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
  const target = findBand(template, parentId);
  if (target)
    return replaceBand(template, target, {
      ...target.band,
      elements: insert(target.band.elements),
    });
  return mapBands(template, (elements) => transformChildrenOf(elements, parentId, insert));
}

/** Remove an element (matched by id, at any depth) from its parent. */
export function removeElement(template: PdfTemplate, elementId: string): PdfTemplate {
  return mapBands(template, (elements) =>
    transformOwner(elements, elementId, (siblings) => siblings.filter((el) => el.id !== elementId)),
  );
}

/**
 * Apply `fn` to **every** element in the template, at any depth. Used for
 * sweeps that are not about one element — e.g. dropping every reference to a
 * style being deleted. Bands whose elements all come back identical keep their
 * reference.
 */
export function mapElements(
  template: PdfTemplate,
  fn: (element: AnyElement) => AnyElement,
): PdfTemplate {
  const walk = (elements: AnyElement[]): AnyElement[] => {
    let changed = false;
    const next = elements.map((el) => {
      const children = elementChildren(el);
      const nextChildren = children ? walk(children) : undefined;
      const withKids =
        nextChildren && nextChildren !== children ? withChildren(el, nextChildren) : el;
      const mapped = fn(withKids);
      if (mapped !== el) changed = true;
      return mapped;
    });
    return changed ? next : elements;
  };
  return mapBands(template, walk);
}

/** Shallow-merge a patch into the page setup. */
export function patchPage(template: PdfTemplate, patch: Partial<PageSetup>): PdfTemplate {
  return { ...template, page: { ...template.page, ...patch } };
}

/** The smallest rect covering every input rect. */
export function boundingBox(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Locate the requested elements, keep only those sharing the **first** one's
 * parent, and return them in document order. Operations that treat a selection
 * as one shape (grouping, capturing a snippet) need a single coordinate space —
 * bounds are relative to the parent, so mixing parents would move things.
 */
export function resolveSiblings(template: PdfTemplate, elementIds: string[]): ElementLocation[] {
  const found = elementIds
    .map((id) => findElement(template, id))
    .filter((loc): loc is ElementLocation => loc !== undefined);
  const first = found[0];
  if (!first) return [];
  return found.filter((loc) => loc.parentId === first.parentId).sort((a, b) => a.index - b.index);
}

/** Shift an element (its whole subtree rides along) by a delta. */
export function translateElement(element: AnyElement, dx: number, dy: number): AnyElement {
  return {
    ...element,
    bounds: { ...element.bounds, x: element.bounds.x + dx, y: element.bounds.y + dy },
  } as AnyElement;
}
