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
import type { AnyElement } from '../model/elements';
import type { DatasetDef } from '../model/dataset';
import type { TemplateMetadata } from '../model/metadata';
import type { PageSetup } from '../model/page';
import type { NamedStyle } from '../model/style';
import type { Rect } from '../model/units';
import type { PdfTemplate } from '../model/template';
import { NO_OP, type Command } from './command';
import {
  findElement,
  insertElement,
  patchPage,
  removeElement,
  updateElement,
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

/** Set an element's z-order (bring-forward / send-to-back, etc.). */
export function setElementZIndex(elementId: string, zIndex: number): Command {
  return patchElement(elementId, { zIndex });
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
// Bands are the ordered sections pagination flows across pages (§6). They are
// addressed by **id**, not index, so a command stays correct across a reorder;
// `moveBand` is the exception, since a reorder is defined by positions.

/** Replace the band list, preserving the template's other fields. */
function withBands(state: PdfTemplate, bands: Band[]): PdfTemplate {
  return { ...state, bands };
}

const bandIndexOf = (state: PdfTemplate, bandId: string): number =>
  state.bands.findIndex((b) => b.id === bandId);

/** Patch a band's settings (type, height, dataset, master, pagination flags…). */
export function patchBand(bandId: string, patch: Partial<Band>): Command {
  return {
    type: 'patchBand',
    apply: (state) => {
      const index = bandIndexOf(state, bandId);
      const band = state.bands[index];
      if (!band) return state;
      const bands = state.bands.slice();
      bands[index] = { ...band, ...patch };
      return withBands(state, bands);
    },
    invert: (state) => {
      const band = state.bands[bandIndexOf(state, bandId)];
      if (!band) return NO_OP;
      const previous = captureKeys(band as unknown as Record<string, unknown>, Object.keys(patch));
      return patchBand(bandId, previous as Partial<Band>);
    },
  };
}

/** Add a band at `index` (default: end of the stack). */
export function addBand(band: Band, index?: number): Command {
  return {
    type: 'addBand',
    apply: (state) => {
      const at =
        index === undefined ? state.bands.length : Math.max(0, Math.min(index, state.bands.length));
      const bands = state.bands.slice();
      bands.splice(at, 0, band);
      return withBands(state, bands);
    },
    invert: () => removeBandById(band.id),
  };
}

/** Remove a band; undo restores it at its original position. */
export function removeBandById(bandId: string): Command {
  return {
    type: 'removeBand',
    apply: (state) =>
      withBands(
        state,
        state.bands.filter((b) => b.id !== bandId),
      ),
    invert: (state) => {
      const index = bandIndexOf(state, bandId);
      const band = state.bands[index];
      if (!band) return NO_OP;
      return addBand(band, index);
    },
  };
}

/** Reorder the band stack by moving the band at `from` to `to`. */
export function moveBand(from: number, to: number): Command {
  return {
    type: 'moveBand',
    apply: (state) => {
      const bands = state.bands.slice();
      const [band] = bands.splice(from, 1);
      if (!band) return state;
      bands.splice(Math.max(0, Math.min(to, bands.length)), 0, band);
      return withBands(state, bands);
    },
    invert: () => moveBand(to, from),
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
