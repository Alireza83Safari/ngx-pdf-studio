/**
 * Reversible command factories (§8). Each captures whatever it needs from the
 * pre-apply state in `invert`, so undo restores the exact prior values. These
 * are the vocabulary the designer dispatches; components never touch the
 * template tree directly.
 */
import type { ElementBase } from '../model/element-base';
import type { AnyElement } from '../model/elements';
import type { PageSetup } from '../model/page';
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
