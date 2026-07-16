/**
 * Custom-element registry (§12): third parties register a renderer under a
 * name; a `custom` element in the template picks it via `renderer` and passes
 * an evaluated `value` plus static `options`. Renderers return neutral
 * {@link VectorOp}s in the element's local space, so the SVG preview and the
 * PDF draw the exact same shapes (§7) — no painter-specific code needed.
 *
 * Mirrors the barcode registry pattern: unknown names resolve to `undefined`,
 * which the layout reports as a non-fatal diagnostic (§9).
 */
import type { VectorOp } from './page';

export interface CustomElementInput {
  /** Evaluated `value` expression (or `undefined` when the element has none). */
  value: unknown;
  /** The element's `options`, passed through verbatim. */
  options: Record<string, unknown>;
  /** Element bounds size, the renderer's local coordinate space. */
  width: number;
  height: number;
}

/** Renders one custom element occurrence into vector draw-ops. */
export type CustomElementRenderer = (input: CustomElementInput) => VectorOp[];

export class ElementRegistry {
  private readonly renderers = new Map<string, CustomElementRenderer>();

  register(name: string, renderer: CustomElementRenderer): this {
    this.renderers.set(name, renderer);
    return this;
  }

  has(name: string): boolean {
    return this.renderers.has(name);
  }

  render(name: string, input: CustomElementInput): VectorOp[] | undefined {
    return this.renderers.get(name)?.(input);
  }

  clone(): ElementRegistry {
    const copy = new ElementRegistry();
    for (const [name, renderer] of this.renderers) copy.register(name, renderer);
    return copy;
  }
}

/** Registry with no built-ins; consumers register their own renderers. */
export function createDefaultElements(): ElementRegistry {
  return new ElementRegistry();
}
