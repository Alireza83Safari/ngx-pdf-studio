/**
 * The top-level template model — the single source of truth the designer edits
 * and the renderer consumes (§4). It is versioned, serializable, and
 * framework-agnostic, and round-trips losslessly.
 */
import type { Band } from './band';
import type { DatasetDef, ParameterDef } from './dataset';
import type { TemplateMetadata } from './metadata';
import type { PageSetup } from './page';
import type { ResourceBundle } from './resource';
import type { NamedStyle } from './style';
import type { VariableDef } from './variable';

/** Current template-format version. Bump on any breaking schema change (§4). */
export const CURRENT_SCHEMA_VERSION = '1.0.0';

export interface PdfTemplate {
  /** Semver of the template format; older versions are migrated on load. */
  schemaVersion: string;
  metadata: TemplateMetadata;
  page: PageSetup;
  /** Reusable styles referenced by id. */
  styles: NamedStyle[];
  /** Declared data shapes/sources. */
  datasets: DatasetDef[];
  /** External inputs (e.g. title, logoUrl). */
  parameters: ParameterDef[];
  /** Ordered sections flowed across pages by the pagination engine. */
  bands: Band[];
  /**
   * Optional document sections, each with **independent page setup** (size,
   * orientation, margins, direction) — for mixed page sizes within one document
   * (§11A-E). When present, sections render in order with continuous page
   * numbers; `bands` above is used only when no sections are declared.
   *
   * The editing layer (`document/`) reaches into sections: elements and bands
   * inside them are found, patched and moved like any other, and there are
   * section-level commands (`addSection`, `patchSection`, …). The *visual
   * designer* still edits one flat band stack, so composing a sectioned document
   * is an API-level task for now.
   */
  sections?: TemplateSection[];
  /** Report variables (running accumulators) exposed as `$vars.<name>` (§11A-D). */
  variables?: VariableDef[];
  /** Embedded fonts/images, by id. */
  resources: ResourceBundle;
}

/** A document section with its own page setup and bands (§11A-E). */
export interface TemplateSection {
  id: string;
  page: PageSetup;
  bands: Band[];
  /**
   * Restart `$page` at 1 from this section (a new numbering group), with
   * `$pageCount` scoped to the group — e.g. per-chapter "Page X of Y".
   * Physical page indices stay absolute, so links/bookmarks remain correct.
   */
  restartPageNumbers?: boolean;
}
