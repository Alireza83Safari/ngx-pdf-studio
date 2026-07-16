/**
 * Immutable operations on a {@link PdfTemplate} used by editor commands (§8).
 * Every function returns a new template with **structural sharing** — only the
 * objects on the path to the change are cloned; everything else is referenced —
 * so undo/redo snapshots stay cheap and the template tree is never mutated in
 * place (the §8 "never mutate the tree directly" rule, enforced by construction).
 */
import type { AnyElement } from '../model/elements';
import type { PageSetup } from '../model/page';
import type { PdfTemplate } from '../model/template';

export interface ElementLocation {
  bandId: string;
  bandIndex: number;
  index: number;
  element: AnyElement;
}

/** Locate a top-level band element by id (container nesting: future work). */
export function findElement(template: PdfTemplate, elementId: string): ElementLocation | undefined {
  for (let bandIndex = 0; bandIndex < template.bands.length; bandIndex++) {
    const band = template.bands[bandIndex];
    if (!band) continue;
    const index = band.elements.findIndex((el) => el.id === elementId);
    if (index >= 0) {
      return { bandId: band.id, bandIndex, index, element: band.elements[index] as AnyElement };
    }
  }
  return undefined;
}

/** Replace an element (matched by id) via `updater`, returning a new template. */
export function updateElement(
  template: PdfTemplate,
  elementId: string,
  updater: (element: AnyElement) => AnyElement,
): PdfTemplate {
  const loc = findElement(template, elementId);
  if (!loc) return template;
  return replaceBandElements(template, loc.bandIndex, (elements) =>
    elements.map((el) => (el.id === elementId ? updater(el) : el)),
  );
}

/** Insert an element into a band at `index` (default: end). */
export function insertElement(
  template: PdfTemplate,
  bandId: string,
  element: AnyElement,
  index?: number,
): PdfTemplate {
  const bandIndex = template.bands.findIndex((b) => b.id === bandId);
  if (bandIndex < 0) return template;
  return replaceBandElements(template, bandIndex, (elements) => {
    const at =
      index === undefined ? elements.length : Math.max(0, Math.min(index, elements.length));
    return [...elements.slice(0, at), element, ...elements.slice(at)];
  });
}

/** Remove an element (matched by id) from its band. */
export function removeElement(template: PdfTemplate, elementId: string): PdfTemplate {
  const loc = findElement(template, elementId);
  if (!loc) return template;
  return replaceBandElements(template, loc.bandIndex, (elements) =>
    elements.filter((el) => el.id !== elementId),
  );
}

/** Shallow-merge a patch into the page setup. */
export function patchPage(template: PdfTemplate, patch: Partial<PageSetup>): PdfTemplate {
  return { ...template, page: { ...template.page, ...patch } };
}

function replaceBandElements(
  template: PdfTemplate,
  bandIndex: number,
  updater: (elements: AnyElement[]) => AnyElement[],
): PdfTemplate {
  const band = template.bands[bandIndex];
  if (!band) return template;
  const bands = template.bands.slice();
  bands[bandIndex] = { ...band, elements: updater(band.elements) };
  return { ...template, bands };
}
