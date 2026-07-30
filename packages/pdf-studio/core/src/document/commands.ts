/**
 * Reversible command factories (§8). Each captures whatever it needs from the
 * pre-apply state in `invert`, so undo restores the exact prior values. These
 * are the vocabulary the designer dispatches; components never touch the
 * template tree directly.
 *
 * Three groups, in order: **element** commands, **band** commands, and
 * **document** commands (metadata, styles, datasets, whole-template swap).
 *
 * Only commands that set an **absolute** target accept a `coalesceKey`. A
 * relative command (`moveElementsBy`) must not coalesce: the store keeps the
 * first step's inverse and replaces the forward command with the latest one, so
 * merging relative deltas would undo only the final increment.
 */
import type { Band } from '../model/band';
import type { ElementBase } from '../model/element-base';
import type { AnyElement, ContainerElement, TableCell } from '../model/elements';
import type { DatasetDef } from '../model/dataset';
import type { TemplateMetadata } from '../model/metadata';
import type { PageSetup } from '../model/page';
import type { FontResource, ImageResource } from '../model/resource';
import type { NamedStyle } from '../model/style';
import type { Rect } from '../model/units';
import type { PdfTemplate, TemplateSection } from '../model/template';
import { NO_OP, type Command } from './command';
import {
  boundingBox,
  elementChildren,
  findBand,
  findElement,
  insertElement,
  mapElements,
  patchPage,
  removeElement,
  replaceBand,
  resolveSiblings,
  translateElement,
  updateElement,
  type ElementLocation,
} from './template-ops';

type ElementPatch = Partial<ElementBase>;

const asElement = (value: ElementBase): AnyElement => value as AnyElement;

function captureKeys(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = source[key];
  return out;
}

/**
 * Bundle several commands into a single, atomically-reversible history step.
 * Sub-commands apply in order; undo replays their inverses in reverse order,
 * each captured against the correct intermediate state — so deleting or
 * duplicating N elements, or dragging a whole selection, is exactly one undo.
 *
 * Pass a `coalesceKey` to merge consecutive composites of the same gesture
 * (e.g. every mouse-move frame of a group drag) into one step.
 */
export function composite(commands: Command[], coalesceKey?: string): Command {
  const kept = commands.filter((c) => c.type !== 'noop');
  if (kept.length === 1 && coalesceKey === undefined) return kept[0] as Command;
  return {
    type: 'composite',
    ...(coalesceKey !== undefined ? { coalesceKey } : {}),
    apply: (state) => kept.reduce((s, c) => c.apply(s), state),
    invert: (state) => {
      const inverses: Command[] = [];
      let s = state;
      for (const c of kept) {
        inverses.push(c.invert(s));
        s = c.apply(s);
      }
      inverses.reverse();
      return composite(inverses);
    },
  };
}

/** Shallow-merge a patch of base properties onto an element. */
export function patchElement(elementId: string, patch: ElementPatch): Command {
  return {
    type: 'patchElement',
    apply: (state) => updateElement(state, elementId, (el) => asElement({ ...el, ...patch })),
    invert: (state) => {
      const loc = findElement(state, elementId);
      if (!loc) return NO_OP;
      const previous = captureKeys(
        loc.element as unknown as Record<string, unknown>,
        Object.keys(patch),
      );
      return patchElement(elementId, previous as ElementPatch);
    },
  };
}

/**
 * Replace an element wholesale. The type-safe `patchElement` only reaches
 * {@link ElementBase} properties; this is the escape hatch for type-specific
 * ones (a table's columns, a barcode's symbology, …).
 */
export function replaceElement(elementId: string, element: AnyElement): Command {
  return {
    type: 'replaceElement',
    apply: (state) => updateElement(state, elementId, () => element),
    invert: (state) => {
      const loc = findElement(state, elementId);
      if (!loc) return NO_OP;
      return replaceElement(elementId, loc.element);
    },
  };
}

/**
 * Transform an element with an arbitrary updater — for edits that depend on the
 * current value (toggles, computed geometry). Undo restores the whole previous
 * element, so the updater need not be reversible itself. Not serializable
 * (it closes over a function), unlike the declarative commands.
 *
 * The updater must be **pure**: it receives the live element and must return a
 * new one. Mutating the argument in place also mutates the element captured for
 * the inverse, which silently breaks undo.
 */
export function modifyElement(
  elementId: string,
  updater: (element: AnyElement) => AnyElement,
): Command {
  return {
    type: 'modifyElement',
    apply: (state) => updateElement(state, elementId, updater),
    invert: (state) => {
      const loc = findElement(state, elementId);
      if (!loc) return NO_OP;
      return replaceElement(elementId, loc.element);
    },
  };
}

/** Move/resize an element by setting its bounds; coalesces while dragging. */
export function setElementBounds(elementId: string, bounds: Rect, coalesce = false): Command {
  return {
    type: 'setElementBounds',
    ...(coalesce ? { coalesceKey: `bounds:${elementId}` } : {}),
    apply: (state) => updateElement(state, elementId, (el) => asElement({ ...el, bounds })),
    invert: (state) => {
      const loc = findElement(state, elementId);
      if (!loc) return NO_OP;
      return setElementBounds(elementId, loc.element.bounds);
    },
  };
}

/**
 * Set the bounds of several elements at once — align, distribute, or a group
 * drag — as one step. Absolute, so it is safe to `coalesceKey` across the frames
 * of a single gesture. Ids that no longer exist are skipped by the inverse.
 */
export function setElementsBounds(bounds: Record<string, Rect>, coalesceKey?: string): Command {
  const ids = Object.keys(bounds);
  return {
    type: 'setElementsBounds',
    ...(coalesceKey !== undefined ? { coalesceKey } : {}),
    apply: (state) =>
      ids.reduce(
        (s, id) => updateElement(s, id, (el) => asElement({ ...el, bounds: bounds[id] as Rect })),
        state,
      ),
    invert: (state) => {
      const previous: Record<string, Rect> = {};
      for (const id of ids) {
        const loc = findElement(state, id);
        if (loc) previous[id] = loc.element.bounds;
      }
      return setElementsBounds(previous);
    },
  };
}

/**
 * Nudge several elements by a delta (arrow keys, paste offset) as one step.
 * Relative, so it is its own exact inverse — and must never be coalesced
 * (see the module note).
 */
export function moveElementsBy(ids: string[], dx: number, dy: number): Command {
  return {
    type: 'moveElementsBy',
    apply: (state) =>
      ids.reduce(
        (s, id) =>
          updateElement(s, id, (el) =>
            asElement({
              ...el,
              bounds: { ...el.bounds, x: el.bounds.x + dx, y: el.bounds.y + dy },
            }),
          ),
        state,
      ),
    invert: () => moveElementsBy(ids, -dx, -dy),
  };
}

/** Set an element's z-order to an absolute value. */
export function setElementZIndex(elementId: string, zIndex: number): Command {
  return patchElement(elementId, { zIndex });
}

/**
 * Rename an element for the designer's layer list; does not affect rendering.
 * Pass `undefined` to clear the name and fall back to the generated label —
 * which **removes** the property rather than setting it to `undefined`, so the
 * serialized template stays clean.
 */
export function renameElement(elementId: string, name: string | undefined): Command {
  return {
    type: 'renameElement',
    apply: (state) =>
      updateElement(state, elementId, (el) => {
        if (name !== undefined) return asElement({ ...el, name });
        const cleared: Record<string, unknown> = { ...el };
        delete cleared['name'];
        return cleared as unknown as AnyElement;
      }),
    invert: (state) => {
      const loc = findElement(state, elementId);
      if (!loc) return NO_OP;
      return renameElement(elementId, loc.element.name);
    },
  };
}

/** Lock or unlock an element against editing (§8A); does not affect rendering. */
export function setElementLocked(elementId: string, locked: boolean): Command {
  return patchElement(elementId, { locked });
}

/** Where to move an element within its siblings' stacking order. */
export type ZOrderMove = 'front' | 'back' | 'forward' | 'backward';

/**
 * Restack an element **relative to its siblings** — the elements sharing its
 * immediate parent, since z-order is local to each band or container. Saves
 * every caller from recomputing sibling min/max, and stays correct inside a
 * group, where the surrounding band's z values are irrelevant.
 *
 * `front`/`back` jump past every sibling. `forward`/`backward` **swap** with the
 * neighbour one step up/down, so repeated presses walk the stack without
 * inflating z values or creating ties (a tie would leave paint order decided by
 * document order, i.e. arbitrary from the author's point of view). Already being
 * at the end of the stack is a no-op.
 */
export function moveElementZ(elementId: string, move: ZOrderMove): Command {
  return {
    type: 'moveElementZ',
    apply: (state) => {
      const plan = planZMove(state, elementId, move);
      if (!plan) return state;
      return Object.entries(plan).reduce(
        (s, [id, zIndex]) => updateElement(s, id, (el) => asElement({ ...el, zIndex })),
        state,
      );
    },
    invert: (state) => {
      const plan = planZMove(state, elementId, move);
      if (!plan) return NO_OP;
      return composite(
        Object.keys(plan).map((id) =>
          setElementZIndex(id, findElement(state, id)?.element.zIndex ?? 0),
        ),
      );
    },
  };
}

/**
 * The `id → new zIndex` assignments `move` implies, or `undefined` when nothing
 * should change. `forward`/`backward` touch two elements (the swap).
 */
function planZMove(
  state: PdfTemplate,
  elementId: string,
  move: ZOrderMove,
): Record<string, number> | undefined {
  const loc = findElement(state, elementId);
  if (!loc) return undefined;
  const siblings = siblingsOf(state, loc).filter((el) => el.id !== elementId);
  if (siblings.length === 0) return undefined;
  const z = loc.element.zIndex;

  if (move === 'front') {
    const max = Math.max(...siblings.map((el) => el.zIndex));
    return z > max ? undefined : { [elementId]: max + 1 };
  }
  if (move === 'back') {
    const min = Math.min(...siblings.map((el) => el.zIndex));
    return z < min ? undefined : { [elementId]: min - 1 };
  }

  const up = move === 'forward';
  const beyond = siblings.filter((el) => (up ? el.zIndex > z : el.zIndex < z));
  if (beyond.length === 0) return undefined;
  const neighbour = beyond.reduce((closest, el) =>
    (up ? el.zIndex < closest.zIndex : el.zIndex > closest.zIndex) ? el : closest,
  );
  return { [elementId]: neighbour.zIndex, [neighbour.id]: z };
}

/** Every element sharing `loc`'s immediate parent, including `loc` itself. */
function siblingsOf(state: PdfTemplate, loc: ElementLocation): AnyElement[] {
  if (loc.containerPath.length === 0) {
    // resolve by id — the band may live inside a section, not at `bands[index]`
    return findBand(state, loc.bandId)?.band.elements ?? [];
  }
  const parent = findElement(state, loc.parentId);
  return (parent && elementChildren(parent.element)) ?? [];
}

/**
 * Add an element to a parent — a band id for a top-level element, or a
 * `container`/`list` id to nest it inside that element (§5).
 */
export function addElement(parentId: string, element: AnyElement, index?: number): Command {
  return {
    type: 'addElement',
    apply: (state) => insertElement(state, parentId, element, index),
    invert: () => removeElementById(element.id),
  };
}

/** Remove an element; undo re-inserts it at its original parent and position. */
export function removeElementById(elementId: string): Command {
  return {
    type: 'removeElement',
    apply: (state) => removeElement(state, elementId),
    invert: (state) => {
      const loc = findElement(state, elementId);
      if (!loc) return NO_OP;
      return addElement(loc.parentId, loc.element, loc.index);
    },
  };
}

// --- grouping --------------------------------------------------------------
// A group is a `container` element: children ride along when it moves, and the
// layout engine paints them relative to its top-left (`paginate.ts`). Grouping
// therefore rebases each child into container-local coordinates, and ungrouping
// puts the offset back — so the rendered result is pixel-identical either way.

/**
 * Wrap several elements in a new `container` sized to their bounding box.
 * The elements must be **siblings** (same band or same container); ids that are
 * missing, or that live elsewhere, are ignored. Fewer than two survivors leaves
 * the template untouched — there is nothing to group.
 *
 * The container lands at the position of the frontmost member, inherits the
 * highest `zIndex` of the group, and children keep their relative order.
 */
export function groupElements(elementIds: string[], containerId: string): Command {
  return {
    type: 'groupElements',
    apply: (state) => {
      const members = resolveSiblings(state, elementIds);
      if (members.length < 2) return state;
      const [{ parentId, index }] = members as [ElementLocation];
      const box = boundingBox(members.map((m) => m.element.bounds));
      const container: ContainerElement = {
        id: containerId,
        type: 'container',
        bounds: box,
        zIndex: Math.max(...members.map((m) => m.element.zIndex)),
        children: members.map((m) => translateElement(m.element, -box.x, -box.y)),
      };
      const without = members.reduce((s, m) => removeElement(s, m.element.id), state);
      return insertElement(without, parentId, container, index);
    },
    invert: () => ungroupContainer(containerId),
  };
}

/**
 * Dissolve a `container`, returning its children to the container's own parent
 * at its position, with the container's offset folded back into their bounds.
 * A missing container, or a non-container id, is a no-op.
 */
export function ungroupContainer(containerId: string): Command {
  return {
    type: 'ungroupContainer',
    apply: (state) => {
      const loc = findElement(state, containerId);
      if (!loc || loc.element.type !== 'container') return state;
      const { bounds, children } = loc.element;
      const without = removeElement(state, containerId);
      return children.reduce(
        (s, child, offset) =>
          insertElement(
            s,
            loc.parentId,
            translateElement(child, bounds.x, bounds.y),
            loc.index + offset,
          ),
        without,
      );
    },
    invert: (state) => {
      const loc = findElement(state, containerId);
      if (!loc || loc.element.type !== 'container') return NO_OP;
      return groupElements(
        loc.element.children.map((c) => c.id),
        containerId,
      );
    },
  };
}

/** Patch the page setup (size, margins, orientation, direction, …). */
export function patchPageSetup(patch: Partial<PageSetup>): Command {
  return {
    type: 'patchPage',
    apply: (state) => patchPage(state, patch),
    invert: (state) => {
      const previous = captureKeys(
        state.page as unknown as Record<string, unknown>,
        Object.keys(patch),
      );
      return patchPageSetup(previous as Partial<PageSetup>);
    },
  };
}

// --- band commands ---------------------------------------------------------
// Bands are the ordered strips pagination flows across pages (§6). They are
// addressed by **id**, not index, so a command stays correct across a reorder;
// `moveBand`/`addBand` take positions, since placement is what they are about.
//
// A band may live at the top level or inside a `TemplateSection` (§11A-E); these
// commands work either way, and `sectionIndex` selects which list to add to.

/** Rewrite one band list — the top level, or a section's. */
function withBandList(
  state: PdfTemplate,
  sectionIndex: number | undefined,
  rewrite: (bands: Band[]) => Band[],
): PdfTemplate {
  if (sectionIndex === undefined) return { ...state, bands: rewrite(state.bands) };
  const sections = (state.sections ?? []).slice();
  const section = sections[sectionIndex];
  if (!section) return state;
  sections[sectionIndex] = { ...section, bands: rewrite(section.bands) };
  return { ...state, sections };
}

const bandListOf = (state: PdfTemplate, sectionIndex?: number): Band[] =>
  sectionIndex === undefined ? state.bands : (state.sections?.[sectionIndex]?.bands ?? []);

/** Patch a band's settings (type, height, dataset, master, pagination flags…). */
export function patchBand(bandId: string, patch: Partial<Band>): Command {
  return {
    type: 'patchBand',
    apply: (state) => {
      const at = findBand(state, bandId);
      return at ? replaceBand(state, at, { ...at.band, ...patch }) : state;
    },
    invert: (state) => {
      const at = findBand(state, bandId);
      if (!at) return NO_OP;
      const previous = captureKeys(
        at.band as unknown as Record<string, unknown>,
        Object.keys(patch),
      );
      return patchBand(bandId, previous as Partial<Band>);
    },
  };
}

/**
 * Add a band at `index` (default: end of the list). `sectionIndex` places it in
 * a document section instead of at the top level.
 */
export function addBand(band: Band, index?: number, sectionIndex?: number): Command {
  return {
    type: 'addBand',
    apply: (state) =>
      withBandList(state, sectionIndex, (bands) => {
        const at = index === undefined ? bands.length : Math.max(0, Math.min(index, bands.length));
        const next = bands.slice();
        next.splice(at, 0, band);
        return next;
      }),
    invert: () => removeBandById(band.id),
  };
}

/** Remove a band; undo restores it at its original position, section included. */
export function removeBandById(bandId: string): Command {
  return {
    type: 'removeBand',
    apply: (state) => {
      const at = findBand(state, bandId);
      if (!at) return state;
      return withBandList(state, at.sectionIndex, (bands) => bands.filter((b) => b.id !== bandId));
    },
    invert: (state) => {
      const at = findBand(state, bandId);
      if (!at) return NO_OP;
      return addBand(at.band, at.index, at.sectionIndex);
    },
  };
}

/**
 * Reorder a band list by moving the band at `from` to `to` — within the top
 * level, or within one section.
 */
export function moveBand(from: number, to: number, sectionIndex?: number): Command {
  return {
    type: 'moveBand',
    apply: (state) => {
      if (from < 0 || from >= bandListOf(state, sectionIndex).length) return state;
      return withBandList(state, sectionIndex, (bands) => {
        const next = bands.slice();
        const [band] = next.splice(from, 1);
        if (!band) return bands;
        next.splice(Math.max(0, Math.min(to, next.length)), 0, band);
        return next;
      });
    },
    invert: () => moveBand(to, from, sectionIndex),
  };
}

// --- section commands (§11A-E) ---------------------------------------------
// Sections give parts of one document their own page setup (size, orientation,
// margins, direction). When any exist, the layout engine renders them in order
// and ignores top-level `bands` — so the two are alternatives, not a mix.

/** Add a document section at `index` (default: end). */
export function addSection(section: TemplateSection, index?: number): Command {
  return {
    type: 'addSection',
    apply: (state) => {
      const sections = (state.sections ?? []).slice();
      const at =
        index === undefined ? sections.length : Math.max(0, Math.min(index, sections.length));
      sections.splice(at, 0, section);
      return { ...state, sections };
    },
    invert: () => removeSectionById(section.id),
  };
}

/** Remove a section (and its bands); undo restores it at its position. */
export function removeSectionById(sectionId: string): Command {
  return {
    type: 'removeSection',
    apply: (state) => {
      const sections = state.sections ?? [];
      if (!sections.some((s) => s.id === sectionId)) return state;
      return { ...state, sections: sections.filter((s) => s.id !== sectionId) };
    },
    invert: (state) => {
      const index = (state.sections ?? []).findIndex((s) => s.id === sectionId);
      const section = state.sections?.[index];
      if (!section) return NO_OP;
      return addSection(section, index);
    },
  };
}

/**
 * Patch a section's own settings — its `page` setup and `restartPageNumbers`.
 * Its bands are edited with the band commands above, which already find them.
 */
export function patchSection(
  sectionId: string,
  patch: Partial<Omit<TemplateSection, 'bands'>>,
): Command {
  return {
    type: 'patchSection',
    apply: (state) => {
      const sections = (state.sections ?? []).slice();
      const index = sections.findIndex((s) => s.id === sectionId);
      const section = sections[index];
      if (!section) return state;
      sections[index] = { ...section, ...patch };
      return { ...state, sections };
    },
    invert: (state) => {
      const section = (state.sections ?? []).find((s) => s.id === sectionId);
      if (!section) return NO_OP;
      const previous = captureKeys(
        section as unknown as Record<string, unknown>,
        Object.keys(patch),
      );
      return patchSection(sectionId, previous as Partial<Omit<TemplateSection, 'bands'>>);
    },
  };
}

/** Reorder the sections — which is also the page order of the document. */
export function moveSection(from: number, to: number): Command {
  return {
    type: 'moveSection',
    apply: (state) => {
      const sections = (state.sections ?? []).slice();
      if (from < 0 || from >= sections.length) return state;
      const [section] = sections.splice(from, 1);
      if (!section) return state;
      sections.splice(Math.max(0, Math.min(to, sections.length)), 0, section);
      return { ...state, sections };
    },
    invert: () => moveSection(to, from),
  };
}

// --- document commands -----------------------------------------------------

/** Patch template metadata (name, author, description, tags…). */
export function patchMetadata(patch: Partial<TemplateMetadata>): Command {
  return {
    type: 'patchMetadata',
    apply: (state) => ({ ...state, metadata: { ...state.metadata, ...patch } }),
    invert: (state) => {
      const previous = captureKeys(
        state.metadata as unknown as Record<string, unknown>,
        Object.keys(patch),
      );
      return patchMetadata(previous as Partial<TemplateMetadata>);
    },
  };
}

/** Convenience: rename the document. */
export function renameTemplate(name: string): Command {
  return patchMetadata({ name });
}

/**
 * Declare styles that are not present yet (matched by id), leaving existing
 * ones untouched. Idempotent: adding a style twice is a no-op, and undo removes
 * **only** what this command actually added — never a pre-existing style.
 * Composited with `addElement` so a table's cell styles arrive atomically.
 */
export function ensureStyles(styles: NamedStyle[]): Command {
  const missing = (state: PdfTemplate): NamedStyle[] => {
    const have = new Set(state.styles.map((s) => s.id));
    return styles.filter((s) => !have.has(s.id));
  };
  return {
    type: 'ensureStyles',
    apply: (state) => {
      const add = missing(state);
      return add.length === 0 ? state : { ...state, styles: [...state.styles, ...add] };
    },
    invert: (state) => {
      const addedIds = new Set(missing(state).map((s) => s.id));
      if (addedIds.size === 0) return NO_OP;
      return {
        type: 'removeStyles',
        apply: (s) => ({ ...s, styles: s.styles.filter((st) => !addedIds.has(st.id)) }),
        invert: () => ensureStyles(styles),
      };
    },
  };
}

/**
 * Declare a dataset by name if the template does not have one yet. Defaults to
 * a `path` source of the same name, which is what binding a band or table to a
 * field path in the designer means. Idempotent, like {@link ensureStyles}.
 */
export function ensureDataset(name: string, source?: DatasetDef['source']): Command {
  const trimmed = name.trim();
  const dataset: DatasetDef = {
    name: trimmed,
    source: source ?? { kind: 'path', path: trimmed },
  };
  const needed = (state: PdfTemplate): boolean =>
    trimmed.length > 0 && !state.datasets.some((d) => d.name === trimmed);
  return {
    type: 'ensureDataset',
    apply: (state) =>
      needed(state) ? { ...state, datasets: [...state.datasets, dataset] } : state,
    invert: (state) => {
      if (!needed(state)) return NO_OP;
      return {
        type: 'removeDataset',
        apply: (s) => ({ ...s, datasets: s.datasets.filter((d) => d.name !== trimmed) }),
        invert: () => ensureDataset(name, source),
      };
    },
  };
}

/**
 * Add an image to `resources.images` if that id is not taken, so an element can
 * reference it by `resourceId`. Idempotent, like {@link ensureStyles} — an
 * editor pairs it with `addElement` in one `composite` so dropping a logo onto
 * the page is a single undo step, and re-adding the same asset does not
 * duplicate the bytes.
 */
export function ensureImageResource(image: ImageResource): Command {
  const needed = (state: PdfTemplate): boolean =>
    !state.resources.images.some((i) => i.id === image.id);
  return {
    type: 'ensureImageResource',
    apply: (state) =>
      needed(state)
        ? {
            ...state,
            resources: { ...state.resources, images: [...state.resources.images, image] },
          }
        : state,
    invert: (state) => {
      if (!needed(state)) return NO_OP;
      return {
        type: 'removeImageResource',
        apply: (s) => ({
          ...s,
          resources: {
            ...s.resources,
            images: s.resources.images.filter((i) => i.id !== image.id),
          },
        }),
        invert: () => ensureImageResource(image),
      };
    },
  };
}

/**
 * Add a font to `resources.fonts` if that id is free, so the template carries
 * its own typeface and renders the same wherever it is opened. Idempotent, like
 * {@link ensureImageResource}.
 *
 * Fonts are *not* pruned automatically the way images are: typography refers to
 * a font by **family name**, not by resource id, so an unreferenced font is
 * usually one the author is about to use rather than garbage.
 */
export function ensureFontResource(font: FontResource): Command {
  const needed = (state: PdfTemplate): boolean =>
    !state.resources.fonts.some((f) => f.id === font.id);
  return {
    type: 'ensureFontResource',
    apply: (state) =>
      needed(state)
        ? { ...state, resources: { ...state.resources, fonts: [...state.resources.fonts, font] } }
        : state,
    invert: (state) => {
      if (!needed(state)) return NO_OP;
      return {
        type: 'removeFontResource',
        apply: (s) => ({
          ...s,
          resources: { ...s.resources, fonts: s.resources.fonts.filter((f) => f.id !== font.id) },
        }),
        invert: () => ensureFontResource(font),
      };
    },
  };
}

/** Remove a font from the bundle by id. */
export function removeFontResource(fontId: string): Command {
  return {
    type: 'removeFontResource',
    apply: (state) => ({
      ...state,
      resources: {
        ...state.resources,
        fonts: state.resources.fonts.filter((f) => f.id !== fontId),
      },
    }),
    invert: (state) => {
      const gone = state.resources.fonts.find((f) => f.id === fontId);
      return gone ? ensureFontResource(gone) : NO_OP;
    },
  };
}

/**
 * Drop images no element references any more. Editors call this after deleting
 * elements so a template does not carry megabytes of orphaned base64 forever.
 */
export function pruneImageResources(): Command {
  const used = (state: PdfTemplate): Set<string> => {
    const ids = new Set<string>();
    const walk = (els: AnyElement[]): void => {
      for (const el of els) {
        if (el.type === 'image' && el.resourceId) ids.add(el.resourceId);
        const kids = (el as { children?: AnyElement[] }).children;
        if (kids) walk(kids);
        const items = (el as { itemTemplate?: AnyElement[] }).itemTemplate;
        if (items) walk(items);
      }
    };
    for (const band of state.bands) walk(band.elements);
    for (const section of state.sections ?? []) for (const b of section.bands) walk(b.elements);
    return ids;
  };
  return {
    type: 'pruneImageResources',
    apply: (state) => {
      const keep = used(state);
      const next = state.resources.images.filter((i) => keep.has(i.id));
      if (next.length === state.resources.images.length) return state;
      return { ...state, resources: { ...state.resources, images: next } };
    },
    invert: (state) => {
      const keep = used(state);
      const dropped = state.resources.images.filter((i) => !keep.has(i.id));
      if (dropped.length === 0) return NO_OP;
      return {
        type: 'restoreImageResources',
        apply: (s) => ({
          ...s,
          resources: { ...s.resources, images: [...s.resources.images, ...dropped] },
        }),
        invert: () => pruneImageResources(),
      };
    },
  };
}

/** Add a named style to the library. */
export function addStyle(style: NamedStyle): Command {
  return {
    type: 'addStyle',
    apply: (state) =>
      state.styles.some((s) => s.id === style.id)
        ? state
        : { ...state, styles: [...state.styles, style] },
    invert: (state) =>
      state.styles.some((s) => s.id === style.id) ? NO_OP : removeStyle(style.id),
  };
}

/**
 * Patch a named style. Every element referencing it re-renders with the new
 * values — that is the point of a style library (§8A-B): edit once, update
 * everywhere.
 */
export function updateStyle(styleId: string, patch: Partial<NamedStyle>): Command {
  return {
    type: 'updateStyle',
    apply: (state) => {
      const index = state.styles.findIndex((s) => s.id === styleId);
      const style = state.styles[index];
      if (!style) return state;
      const styles = state.styles.slice();
      styles[index] = { ...style, ...patch };
      return { ...state, styles };
    },
    invert: (state) => {
      const style = state.styles.find((s) => s.id === styleId);
      if (!style) return NO_OP;
      const previous = captureKeys(style as unknown as Record<string, unknown>, Object.keys(patch));
      return updateStyle(styleId, previous as Partial<NamedStyle>);
    },
  };
}

/**
 * Copy a style under a new id — the usual way to start a variant without
 * disturbing the elements already using the original.
 */
export function duplicateStyle(styleId: string, newId: string, name?: string): Command {
  return {
    type: 'duplicateStyle',
    apply: (state) => {
      const style = state.styles.find((s) => s.id === styleId);
      if (!style || state.styles.some((s) => s.id === newId)) return state;
      return {
        ...state,
        styles: [...state.styles, { ...style, id: newId, ...(name ? { name } : {}) }],
      };
    },
    invert: (state) => {
      const exists = state.styles.some((s) => s.id === styleId);
      return exists && !state.styles.some((s) => s.id === newId) ? removeStyle(newId) : NO_OP;
    },
  };
}

/**
 * Delete a named style **and drop every reference to it** — element `styleId`s,
 * table cell styles, and a table's row-stripe style. Leaving them dangling would
 * silently restyle those elements (style lookup just misses, with no
 * diagnostic), so the cleanup is part of the same step.
 *
 * The inverse restores the previous template wholesale rather than replaying N
 * per-element patches: one reference is cheaper than reconstructing the sweep,
 * and it is exactly correct.
 */
export function removeStyle(styleId: string): Command {
  return {
    type: 'removeStyle',
    apply: (state) => {
      if (!state.styles.some((s) => s.id === styleId)) return state;
      const withoutRefs = mapElements(state, (el) => dropStyleRef(el, styleId));
      return { ...withoutRefs, styles: withoutRefs.styles.filter((s) => s.id !== styleId) };
    },
    invert: (state) =>
      state.styles.some((s) => s.id === styleId) ? replaceTemplate(state) : NO_OP,
  };
}

/**
 * Strip references to `styleId` from an element (including table cells).
 *
 * Built on a plain record copy: `Omit` over the `AnyElement` union collapses the
 * discriminant, and properties are **deleted** rather than set to `undefined` so
 * the serialized template stays clean. Returns the input untouched when it holds
 * no reference, which keeps `mapElements`' structural sharing intact.
 */
function dropStyleRef(element: AnyElement, styleId: string): AnyElement {
  const table = element.type === 'table' ? element : undefined;
  const next: Record<string, unknown> = { ...element };
  let changed = false;

  if (element.styleId === styleId) {
    delete next['styleId'];
    changed = true;
  }
  if (table) {
    if (table.rowStripeStyleId === styleId) {
      delete next['rowStripeStyleId'];
      changed = true;
    }
    const columns = table.columns.map((column) => {
      const stale = (['header', 'footer', 'detail'] as const).filter(
        (slot) => column[slot]?.styleId === styleId,
      );
      if (stale.length === 0) return column;
      const patched = { ...column };
      for (const slot of stale) {
        const cell: Record<string, unknown> = { ...(patched[slot] as TableCell) };
        delete cell['styleId'];
        patched[slot] = cell as TableCell;
      }
      return patched;
    });
    if (columns.some((column, i) => column !== table.columns[i])) {
      next['columns'] = columns;
      changed = true;
    }
  }
  return changed ? (next as unknown as AnyElement) : element;
}

/**
 * Swap the whole template as one undoable step — loading a gallery template,
 * restoring a version, or accepting a Copilot result — so the user can still
 * press undo to get their previous document back.
 */
export function replaceTemplate(next: PdfTemplate): Command {
  return {
    type: 'replaceTemplate',
    apply: () => next,
    invert: (state) => replaceTemplate(state),
  };
}

/** Convenience: replace an element's text (static text content). */
export function setStaticText(elementId: string, text: string): Command {
  return {
    type: 'setStaticText',
    apply: (state) =>
      updateElement(state, elementId, (el) => (el.type === 'staticText' ? { ...el, text } : el)),
    invert: (state) => {
      const loc = findElement(state, elementId);
      if (!loc || loc.element.type !== 'staticText') return NO_OP;
      return setStaticText(elementId, loc.element.text);
    },
  };
}

/** Re-export for callers building inverses. */
export { NO_OP } from './command';
export type { PdfTemplate };
