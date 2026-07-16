/**
 * An expression is stored as its **source string** only (e.g. `"anbar.name"`,
 * `"items[0].price * qty"`). It is compiled and evaluated by the sandboxed
 * expression engine at render time (§9) — never with `eval`/`Function`. Storing
 * source (not a parsed AST) keeps the template human-readable and round-trips
 * losslessly.
 */
export interface Expression {
  /** The expression source, in the sandboxed expression language (§9). */
  source: string;
}

/** Build an {@link Expression} from its source string. */
export const expr = (source: string): Expression => ({ source });
