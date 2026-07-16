/**
 * The scope chain and its documented resolution order (§9):
 *
 *   built-in vars (`$index`, `$page`, …) → current band item (row; innermost
 *   first) → declared `parameters` → root `data`.
 *
 * Bare identifiers resolve through this chain; `$root` and `$parameters` give
 * explicit access to the outer scopes from inside a repeating band.
 */

/** Built-in variables available inside a repeating band (§6, §9). */
export interface BuiltinVars {
  $index?: number;
  $first?: boolean;
  $last?: boolean;
  $groupIndex?: number;
  $page?: number;
  $pageCount?: number;
  [key: string]: unknown;
}

const hasOwn = (obj: unknown, key: string): boolean =>
  typeof obj === 'object' && obj !== null && Object.prototype.hasOwnProperty.call(obj, key);

export class Scope {
  private constructor(
    private readonly builtins: Record<string, unknown>,
    /** Outermost → innermost; searched innermost-first. */
    private readonly rows: ReadonlyArray<Record<string, unknown>>,
    private readonly parameters: Record<string, unknown>,
    private readonly data: Record<string, unknown>,
  ) {}

  /** Create a root scope from render inputs. */
  static create(input: {
    data?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    builtins?: BuiltinVars;
  }): Scope {
    const data = input.data ?? {};
    const parameters = input.parameters ?? {};
    const builtins: Record<string, unknown> = {
      ...input.builtins,
      $root: data,
      $parameters: parameters,
    };
    return new Scope(builtins, [], parameters, data);
  }

  /**
   * Derive a child scope for one row of a repeating band: pushes `item` as the
   * innermost row frame and merges fresh built-in vars (`$index`, …).
   */
  child(item: Record<string, unknown>, builtins: BuiltinVars = {}): Scope {
    return new Scope(
      { ...this.builtins, ...builtins },
      [...this.rows, item],
      this.parameters,
      this.data,
    );
  }

  /** Resolve a bare identifier, honoring the precedence chain. */
  resolve(name: string): { found: boolean; value: unknown } {
    if (hasOwn(this.builtins, name)) return { found: true, value: this.builtins[name] };
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i] as Record<string, unknown>;
      if (hasOwn(row, name)) return { found: true, value: row[name] };
    }
    if (hasOwn(this.parameters, name)) return { found: true, value: this.parameters[name] };
    if (hasOwn(this.data, name)) return { found: true, value: this.data[name] };
    return { found: false, value: null };
  }
}
