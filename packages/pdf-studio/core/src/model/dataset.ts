/**
 * Declared datasets and external parameters (§9). A dataset names a data shape
 * and where its rows come from — a path into the root data JSON, or a
 * registered async provider. Detail/table bands bind to a dataset; iterating it
 * sets the row scope.
 */
import type { Expression } from './expression';

/** Lightweight field descriptor powering the designer's field picker (§8). */
export interface FieldShape {
  path: string;
  type?: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  label?: string;
  /** Nested fields for objects / array-element shapes. */
  fields?: FieldShape[];
}

export type DatasetSource =
  | { kind: 'path'; path: string }
  | { kind: 'expression'; expr: Expression }
  | { kind: 'provider'; provider: string; params?: Record<string, unknown> };

export interface DatasetDef {
  name: string;
  source: DatasetSource;
  /** Optional declared shape for tooling/validation. */
  shape?: FieldShape[];
  /** Declarative sort/filter/group applied before binding (§11A-D). */
  sortBy?: { expr: Expression; direction: 'asc' | 'desc' }[];
  filter?: Expression;
  groupBy?: Expression[];
}

export type ParameterType = 'string' | 'number' | 'boolean' | 'date' | 'color' | 'image';

export interface ParameterDef {
  name: string;
  type: ParameterType;
  label?: string;
  defaultValue?: unknown;
  required?: boolean;
}
