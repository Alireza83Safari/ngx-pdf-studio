/**
 * Pratt / precedence-climbing parser for the expression language (§9). Produces
 * an {@link Expr} AST. Method calls are intentionally unsupported — calls are
 * only on bare identifiers, which the evaluator resolves against the
 * **whitelisted** function table, so untrusted templates cannot reach host
 * methods (§2.3). A nesting-depth guard bounds adversarial input.
 */
import type { BinaryOperator, Expr, LogicalOperator, UnaryOperator } from './ast';
import { ExpressionParseError } from './errors';
import { tokenize } from './lexer';
import type { Token } from './token';

const BINARY_PREC: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '===': 4,
  '!==': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
};
const LOGICAL_OPS = new Set(['&&', '||']);
const MAX_DEPTH = 200;

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.parseConditional();
    if (this.peek().type !== 'eof') {
      throw new ExpressionParseError(`Unexpected token '${this.peek().value}'`, this.peek().start);
    }
    return expr;
  }

  private peek(): Token {
    return this.tokens[this.pos] as Token;
  }

  private expectPunct(value: string): void {
    const t = this.peek();
    if (t.type !== 'punct' || t.value !== value) {
      throw new ExpressionParseError(`Expected '${value}' but found '${t.value}'`, t.start);
    }
    this.pos++;
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) {
      throw new ExpressionParseError('Expression nesting too deep', this.peek().start);
    }
  }

  private parseConditional(): Expr {
    this.enter();
    const test = this.parseBinary(0);
    const t = this.peek();
    if (t.type === 'punct' && t.value === '?') {
      this.pos++;
      const consequent = this.parseConditional();
      this.expectPunct(':');
      const alternate = this.parseConditional();
      this.depth--;
      return { kind: 'conditional', test, consequent, alternate };
    }
    this.depth--;
    return test;
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'punct') break;
      const prec = BINARY_PREC[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.pos++;
      const right = this.parseBinary(prec + 1);
      left = LOGICAL_OPS.has(t.value)
        ? { kind: 'logical', operator: t.value as LogicalOperator, left, right }
        : { kind: 'binary', operator: t.value as BinaryOperator, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === 'punct' && (t.value === '-' || t.value === '+' || t.value === '!')) {
      this.pos++;
      const operand = this.parseUnary();
      return { kind: 'unary', operator: t.value as UnaryOperator, operand };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'punct' && t.value === '.') {
        this.pos++;
        const name = this.peek();
        if (name.type !== 'identifier') {
          throw new ExpressionParseError('Expected property name after "."', name.start);
        }
        this.pos++;
        expr = { kind: 'member', object: expr, property: name.value };
      } else if (t.type === 'punct' && t.value === '[') {
        this.pos++;
        const index = this.parseConditional();
        this.expectPunct(']');
        expr = { kind: 'index', object: expr, index };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): Expr {
    this.enter();
    const t = this.peek();
    let result: Expr;
    switch (t.type) {
      case 'number':
        this.pos++;
        result = { kind: 'literal', value: t.literal as number };
        break;
      case 'string':
        this.pos++;
        result = { kind: 'literal', value: t.literal as string };
        break;
      case 'true':
        this.pos++;
        result = { kind: 'literal', value: true };
        break;
      case 'false':
        this.pos++;
        result = { kind: 'literal', value: false };
        break;
      case 'null':
        this.pos++;
        result = { kind: 'literal', value: null };
        break;
      case 'identifier': {
        this.pos++;
        const after = this.peek();
        if (after.type === 'punct' && after.value === '(') {
          result = this.parseCall(t.value);
        } else {
          result = { kind: 'identifier', name: t.value };
        }
        break;
      }
      case 'punct':
        if (t.value === '(') {
          this.pos++;
          result = this.parseConditional();
          this.expectPunct(')');
          break;
        }
        if (t.value === '[') {
          result = this.parseArray();
          break;
        }
        if (t.value === '{') {
          result = this.parseObject();
          break;
        }
        throw new ExpressionParseError(`Unexpected token '${t.value}'`, t.start);
      default:
        throw new ExpressionParseError('Unexpected end of expression', t.start);
    }
    this.depth--;
    return result;
  }

  private parseCall(callee: string): Expr {
    this.expectPunct('(');
    const args: Expr[] = [];
    if (!(this.peek().type === 'punct' && this.peek().value === ')')) {
      args.push(this.parseConditional());
      while (this.peek().type === 'punct' && this.peek().value === ',') {
        this.pos++;
        args.push(this.parseConditional());
      }
    }
    this.expectPunct(')');
    return { kind: 'call', callee, args };
  }

  private parseObject(): Expr {
    this.expectPunct('{');
    const properties: { key: string; value: Expr }[] = [];
    const parseEntry = (): void => {
      const keyTok = this.peek();
      if (keyTok.type !== 'identifier' && keyTok.type !== 'string') {
        throw new ExpressionParseError('Expected object key', keyTok.start);
      }
      this.pos++;
      this.expectPunct(':');
      properties.push({ key: keyTok.value, value: this.parseConditional() });
    };
    if (!(this.peek().type === 'punct' && this.peek().value === '}')) {
      parseEntry();
      while (this.peek().type === 'punct' && this.peek().value === ',') {
        this.pos++;
        parseEntry();
      }
    }
    this.expectPunct('}');
    return { kind: 'object', properties };
  }

  private parseArray(): Expr {
    this.expectPunct('[');
    const elements: Expr[] = [];
    if (!(this.peek().type === 'punct' && this.peek().value === ']')) {
      elements.push(this.parseConditional());
      while (this.peek().type === 'punct' && this.peek().value === ',') {
        this.pos++;
        elements.push(this.parseConditional());
      }
    }
    this.expectPunct(']');
    return { kind: 'array', elements };
  }
}

/** Parse an expression source into an AST. Throws {@link ExpressionParseError}. */
export function parseExpression(source: string): Expr {
  return new Parser(tokenize(source)).parse();
}
