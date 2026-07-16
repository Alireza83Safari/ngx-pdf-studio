/**
 * Schema migration pipeline (§4). Older templates are migrated to the current
 * `schemaVersion` on load, before validation. Migration steps form a chain keyed
 * on `from → to`; `migrateToCurrent` walks the chain until the template reaches
 * {@link CURRENT_SCHEMA_VERSION} or no further step applies.
 *
 * `1.0.0` is the first published version, so the built-in chain is empty. New
 * versions append a step; the chain and its fixtures are covered by tests.
 */
import { CURRENT_SCHEMA_VERSION } from '../model/template';

/** A raw, not-yet-validated template object. */
export type RawTemplate = Record<string, unknown>;

export interface MigrationStep {
  from: string;
  to: string;
  migrate: (template: RawTemplate) => RawTemplate;
}

/** Built-in migration chain, ordered oldest → newest. */
const BUILT_IN_MIGRATIONS: readonly MigrationStep[] = [];

/**
 * Bring a raw template up to {@link CURRENT_SCHEMA_VERSION} by applying matching
 * migration steps in sequence. Unknown/missing versions and absent steps stop
 * the walk and return what we have (validation then reports any residual issue).
 *
 * @param raw   the parsed template object
 * @param steps migration chain (defaults to the built-in chain)
 */
export function migrateToCurrent(
  raw: RawTemplate,
  steps: readonly MigrationStep[] = BUILT_IN_MIGRATIONS,
): RawTemplate {
  let current = raw;
  let version = typeof current['schemaVersion'] === 'string' ? current['schemaVersion'] : undefined;

  // Bounded by the number of steps to guarantee termination on cyclic chains.
  for (let guard = 0; guard <= steps.length && version !== CURRENT_SCHEMA_VERSION; guard++) {
    const step = steps.find((s) => s.from === version);
    if (!step) break;
    current = step.migrate(current);
    current = { ...current, schemaVersion: step.to };
    version = step.to;
  }

  return current;
}
