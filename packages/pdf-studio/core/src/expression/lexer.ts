/**
 * Hand-written lexer for the expression language. Produces a flat token stream
 * for the Pratt parser. No regex-based `eval` tricks — a simple, auditable scan.
 */
import { ExpressionParseError } from './errors';
import type { Token, TokenType } from './token';

const KEYWORDS: Record<string, TokenType> = {
  true: 'true',
  false: 'false',
  null: 'null',
};

/** Multi-character punctuators, longest first so `<=` beats `<`. */
const PUNCTUATORS = [
  '===',
  '!==',
  '??',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '.',
  '[',
  ']',
  '(',
  ')',
  '{',
  '}',
  ',',
  '?',
  ':',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '!',
];

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i] as string;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      const start = i;
      while (i < source.length && isDigit(source[i] as string)) i++;
      if (source[i] === '.') {
        i++;
        while (i < source.length && isDigit(source[i] as string)) i++;
      }
      const text = source.slice(start, i);
      tokens.push({ type: 'number', value: text, literal: Number(text), start });
      continue;
    }

    if (c === '"' || c === "'") {
      const start = i;
      const quote = c;
      i++;
      let str = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          const next = source[i + 1];
          str += next === 'n' ? '\n' : next === 't' ? '\t' : (next ?? '');
          i += 2;
        } else {
          str += source[i];
          i++;
        }
      }
      if (i >= source.length) {
        throw new ExpressionParseError('Unterminated string literal', start);
      }
      i++; // closing quote
      tokens.push({ type: 'string', value: str, literal: str, start });
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i] as string)) i++;
      const text = source.slice(start, i);
      const keyword = KEYWORDS[text];
      tokens.push({ type: keyword ?? 'identifier', value: text, start });
      continue;
    }

    const punct = PUNCTUATORS.find((p) => source.startsWith(p, i));
    if (punct) {
      tokens.push({ type: 'punct', value: punct, start: i });
      i += punct.length;
      continue;
    }

    throw new ExpressionParseError(`Unexpected character '${c}'`, i);
  }

  tokens.push({ type: 'eof', value: '', start: source.length });
  return tokens;
}
