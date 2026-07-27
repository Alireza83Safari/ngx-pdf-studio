/**
 * Logical → physical bounds (§4, §7).
 *
 * `bounds.x` is always physical: x=0 is the left paper edge, whatever the page
 * `direction` is. That makes right-to-left documents awkward to author — the
 * title of an RTL invoice belongs at the *right*, so it has to be placed at
 * `contentWidth - width`, and every label/value pair reads backwards in the
 * source. Templates written the natural way come out mirrored, which is exactly
 * the mistake the bundled starter templates all made.
 *
 * A page that opts into `coordinates: 'logical'` is authored the way it reads
 * (x=0 is the *start* edge) and this pass mirrors it to physical once, before
 * layout, so both painters and the designer canvas agree. LTR pages are left
 * alone, so the flag is safe to set unconditionally.
 */
import type { AnyElement } from '../model/elements';
import type { PageSetup } from '../model/page';
import type { Band } from '../model/band';
import type { PdfTemplate } from '../model/template';
import { resolvePageSize } from './page-size';

/** Does this page need mirroring? LTR logical coordinates are already physical. */
function isMirrored(page: PageSetup): boolean {
  return page.coordinates === 'logical' && page.direction === 'rtl';
}

/**
 * The width elements are authored against. Multi-column pages flow bands at
 * column width ("bands are assumed authored at column width" — `paginate`), so
 * that, not the full content box, is what a band-relative x mirrors in.
 */
function authoringWidth(page: PageSetup): number {
  const size = resolvePageSize(page.size, page.orientation);
  const content = size.width - page.margins.left - page.margins.right;
  const count = page.columns && page.columns.count > 1 ? page.columns.count : 1;
  if (count === 1) return content;
  const gap = page.columns?.gap ?? 0;
  return (content - gap * (count - 1)) / count;
}

/** Children of containers/list items are relative to their own box, not the page. */
function mirrorElement(el: AnyElement, width: number): AnyElement {
  const bounds = { ...el.bounds, x: width - el.bounds.x - el.bounds.width };
  if (el.type === 'container') {
    return { ...el, bounds, children: mirrorElements(el.children, el.bounds.width) };
  }
  if (el.type === 'list') {
    return { ...el, bounds, itemTemplate: mirrorElements(el.itemTemplate, el.bounds.width) };
  }
  return { ...el, bounds };
}

function mirrorElements(elements: readonly AnyElement[], width: number): AnyElement[] {
  return elements.map((el) => mirrorElement(el, width));
}

function mirrorBands(bands: readonly Band[], width: number): Band[] {
  return bands.map((band) => ({ ...band, elements: mirrorElements(band.elements, width) }));
}

/**
 * Mirror every page authored in logical coordinates. Returns `template`
 * unchanged (same reference) when nothing opts in, so the common path stays
 * allocation-free.
 */
export function withLogicalBounds(template: PdfTemplate): PdfTemplate {
  const rootMirrored = isMirrored(template.page);
  const sectionsMirrored = template.sections?.some((s) => isMirrored(s.page)) ?? false;
  if (!rootMirrored && !sectionsMirrored) return template;

  const next: PdfTemplate = { ...template };
  if (rootMirrored) next.bands = mirrorBands(template.bands, authoringWidth(template.page));
  if (template.sections) {
    next.sections = template.sections.map((section) =>
      isMirrored(section.page)
        ? { ...section, bands: mirrorBands(section.bands, authoringWidth(section.page)) }
        : section,
    );
  }
  return next;
}
