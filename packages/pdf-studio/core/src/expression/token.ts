/**
 * Token model for the sandboxed expression language (§9). The language is a
 * small, side-effect-free expression grammar — never `eval`/`Function` (§2.3).
 */
export type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'true'
  | 'false'
  | 'null'
  | 'punct'
  | 'eof';

export interface Token {
  type: TokenType;
  /** Literal value for `number`/`string`; raw text for `identifier`/`punct`. */
  value: string;
  /** Decoded value for `number`/`string` literals. */
  literal?: number | string;
  /** 0-based source offset, for diagnostics. */
  start: number;
}
