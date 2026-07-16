import { Scope } from '../expression/scope';
import type { DatasetDef } from '../model/dataset';
import { resolveDataset } from './dataset-resolver';
import { createRenderContext, type RenderContext } from './render-context';

function setup(data: Record<string, unknown>): { ctx: RenderContext; scope: Scope } {
  const ctx = createRenderContext({ data });
  return { ctx, scope: Scope.create({ data, parameters: {} }) };
}

describe('resolveDataset (§9, §11A-D)', () => {
  it('resolves a path source to rows', () => {
    const { ctx, scope } = setup({ items: [{ n: 1 }, { n: 2 }] });
    const def: DatasetDef = { name: 'items', source: { kind: 'path', path: 'items' } };
    expect(resolveDataset(def, scope, ctx)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('resolves an expression source (nested path)', () => {
    const { ctx, scope } = setup({ order: { lines: [{ p: 9 }] } });
    const def: DatasetDef = {
      name: 'lines',
      source: { kind: 'expression', expr: { source: 'order.lines' } },
    };
    expect(resolveDataset(def, scope, ctx)).toEqual([{ p: 9 }]);
  });

  it('returns an empty array for non-array sources', () => {
    const { ctx, scope } = setup({ items: 5 });
    const def: DatasetDef = { name: 'items', source: { kind: 'path', path: 'items' } };
    expect(resolveDataset(def, scope, ctx)).toEqual([]);
  });

  it('applies a declarative filter', () => {
    const { ctx, scope } = setup({ items: [{ price: 3 }, { price: 10 }, { price: 7 }] });
    const def: DatasetDef = {
      name: 'items',
      source: { kind: 'path', path: 'items' },
      filter: { source: 'price > 5' },
    };
    expect(resolveDataset(def, scope, ctx)).toEqual([{ price: 10 }, { price: 7 }]);
  });

  it('applies a stable multi-key sort', () => {
    const { ctx, scope } = setup({
      items: [
        { g: 'b', n: 1 },
        { g: 'a', n: 2 },
        { g: 'a', n: 1 },
      ],
    });
    const def: DatasetDef = {
      name: 'items',
      source: { kind: 'path', path: 'items' },
      sortBy: [
        { expr: { source: 'g' }, direction: 'asc' },
        { expr: { source: 'n' }, direction: 'desc' },
      ],
    };
    expect(resolveDataset(def, scope, ctx)).toEqual([
      { g: 'a', n: 2 },
      { g: 'a', n: 1 },
      { g: 'b', n: 1 },
    ]);
  });

  it('records a non-fatal warning for unsupported provider sources', () => {
    const { ctx, scope } = setup({});
    const def: DatasetDef = { name: 'remote', source: { kind: 'provider', provider: 'rest' } };
    expect(resolveDataset(def, scope, ctx)).toEqual([]);
    expect(ctx.diagnostics.some((d) => /provider 'rest'/.test(d.message))).toBe(true);
  });
});
