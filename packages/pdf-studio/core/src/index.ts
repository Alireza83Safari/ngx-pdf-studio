/**
 * Public API of `@ngx-pdf-studio/core` — the framework-agnostic engine.
 *
 * Phase 0 surface: the template model, its runtime validator, and lossless
 * (de)serialization + migration. Expression engine, pagination, binding, and
 * the PDF painter are exported here as later phases land (§15).
 */
export * from './model';
export * from './expression';
export * from './barcode';
export * from './copilot';
export * from './binding';
export * from './document';
export * from './i18n';
export * from './layout';
export * from './paint';
export * from './render';
export { templateSchema } from './validation/template.schema';
export { elementSchema } from './validation/element.schema';
export {
  validateTemplate,
  isValidTemplate,
  type ValidationResult,
  type ValidationIssue,
} from './validation/validate';
export {
  serializeTemplate,
  deserializeTemplate,
  importTemplate,
  type SerializeOptions,
} from './serialization/serialize';
export { migrateToCurrent, type MigrationStep, type RawTemplate } from './serialization/migrate';
