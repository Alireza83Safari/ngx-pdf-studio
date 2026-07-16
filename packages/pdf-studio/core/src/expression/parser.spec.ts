import { parseExpression } from './parser';

describe('expression parser (§9)', () => {
  it('parses chained member access', () => {
    expect(parseExpression('a.b.c')).toEqual({
      kind: 'member',
      property: 'c',
      object: { kind: 'member', property: 'b', object: { kind: 'identifier', name: 'a' } },
    });
  });

  it('honors arithmetic precedence (* binds tighter than +)', () => {
    const ast = parseExpression('1 + 2 * 3');
    expect(ast).toMatchObject({
      kind: 'binary',
      operator: '+',
      right: { kind: 'binary', operator: '*' },
    });
  });

  it('parses indexing and calls', () => {
    expect(parseExpression('items[0].price')).toMatchObject({
      kind: 'member',
      property: 'price',
      object: { kind: 'index', object: { kind: 'identifier', name: 'items' } },
    });
    expect(parseExpression('sum(items, price)')).toMatchObject({
      kind: 'call',
      callee: 'sum',
      args: [
        { kind: 'identifier', name: 'items' },
        { kind: 'identifier', name: 'price' },
      ],
    });
  });

  it('parses a right-associative ternary', () => {
    expect(parseExpression('a ? b : c ? d : e')).toMatchObject({
      kind: 'conditional',
      alternate: { kind: 'conditional' },
    });
  });

  it('parses array literals', () => {
    expect(parseExpression('[1, 2, 3]')).toMatchObject({ kind: 'array' });
  });

  it('rejects method calls (no host methods reachable)', () => {
    expect(() => parseExpression('a.b()')).toThrow();
  });

  it('throws on unterminated strings and stray tokens', () => {
    expect(() => parseExpression('"oops')).toThrow();
    expect(() => parseExpression('1 + ')).toThrow();
    expect(() => parseExpression('@')).toThrow();
  });

  it('bounds nesting depth against adversarial input', () => {
    const deep = '('.repeat(500) + '1' + ')'.repeat(500);
    expect(() => parseExpression(deep)).toThrow(/too deep/);
  });
});
