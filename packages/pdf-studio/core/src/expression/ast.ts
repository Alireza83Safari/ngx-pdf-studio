/**
 * AST node types for the expression language. A pure data structure — the
 * evaluator walks it; nothing here executes host code.
 */
export type Expr =
  | LiteralExpr
  | IdentifierExpr
  | MemberExpr
  | IndexExpr
  | CallExpr
  | UnaryExpr
  | BinaryExpr
  | LogicalExpr
  | ConditionalExpr
  | ArrayExpr
  | ObjectExpr;

export interface LiteralExpr {
  kind: 'literal';
  value: number | string | boolean | null;
}

export interface IdentifierExpr {
  kind: 'identifier';
  name: string;
}

/** `object.property` (property is a static name). */
export interface MemberExpr {
  kind: 'member';
  object: Expr;
  property: string;
}

/** `object[expr]` (computed index/key). */
export interface IndexExpr {
  kind: 'index';
  object: Expr;
  index: Expr;
}

/** `callee(args...)`; callee resolves to a whitelisted function name only. */
export interface CallExpr {
  kind: 'call';
  callee: string;
  args: Expr[];
}

export type UnaryOperator = '-' | '+' | '!';

export interface UnaryExpr {
  kind: 'unary';
  operator: UnaryOperator;
  operand: Expr;
}

export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '==='
  | '!=='
  | '<'
  | '<='
  | '>'
  | '>='
  | '??';

export interface BinaryExpr {
  kind: 'binary';
  operator: BinaryOperator;
  left: Expr;
  right: Expr;
}

export type LogicalOperator = '&&' | '||';

export interface LogicalExpr {
  kind: 'logical';
  operator: LogicalOperator;
  left: Expr;
  right: Expr;
}

export interface ConditionalExpr {
  kind: 'conditional';
  test: Expr;
  consequent: Expr;
  alternate: Expr;
}

export interface ArrayExpr {
  kind: 'array';
  elements: Expr[];
}

/** `{ key: expr, "other key": expr }` — used mainly for function option args. */
export interface ObjectExpr {
  kind: 'object';
  properties: { key: string; value: Expr }[];
}
