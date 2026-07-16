/**
 * Lays out a {@link ListElement} / repeater (§5): repeats a free-form
 * sub-layout (`itemTemplate`) once per bound dataset row, flowing vertically
 * (default) or horizontally. Each item's elements resolve in the row scope
 * (`$index`/`$first`/`$last`) via the shared {@link layoutLeaf}, then are offset
 * into the item's slot.
 */
import { resolveLocale } from '../binding/effective-locale';
import type { Scope } from '../expression/scope';
import type { ListElement } from '../model/elements';
import { isVisible, layoutLeaf, type LeafDeps } from './leaf-layout';
import type { LaidOutElement } from './page';

export interface ListLayout {
  elements: LaidOutElement[];
  height: number;
}

export function layoutList(
  list: ListElement,
  scope: Scope,
  deps: LeafDeps,
  resolveRows: (datasetName: string, scope: Scope) => Record<string, unknown>[],
): ListLayout {
  const rows = resolveRows(list.dataset, scope);
  const vertical = (list.orientation ?? 'vertical') === 'vertical';
  const gap = list.gap ?? 0;
  const itemExtent = vertical ? list.itemHeight : itemWidth(list);

  const elements: LaidOutElement[] = [];
  rows.forEach((row, index) => {
    const rowScope = scope.child(row, {
      $index: index,
      $first: index === 0,
      $last: index === rows.length - 1,
    });
    const slot = index * (itemExtent + gap);
    const dx = list.bounds.x + (vertical ? 0 : slot);
    const dy = list.bounds.y + (vertical ? slot : 0);

    for (const itemEl of list.itemTemplate) {
      const locale = resolveLocale(deps.pageLocale, list.locale, itemEl.locale);
      if (!isVisible(itemEl, rowScope, locale, deps.ctx)) continue;
      const laid = layoutLeaf(itemEl, rowScope, list.locale, list.direction, deps);
      elements.push({
        ...laid,
        id: `${list.id}:${index}:${itemEl.id}`,
        bounds: { ...laid.bounds, x: laid.bounds.x + dx, y: laid.bounds.y + dy },
      });
    }
  });

  const count = rows.length;
  const span = count > 0 ? count * itemExtent + (count - 1) * gap : 0;
  return { elements, height: vertical ? span : list.itemHeight };
}

function itemWidth(list: ListElement): number {
  return list.itemTemplate.reduce((max, el) => Math.max(max, el.bounds.x + el.bounds.width), 0);
}
