/**
 * Document-level work limits (`layout/limits.ts`).
 *
 * The engine bounded a single expression and nothing bigger, which left the
 * gap these close: a template is paid for by the row, not by the byte, so a
 * small body can buy an unbounded amount of layout. What is asserted here is
 * that each ceiling is reached by realistic work rather than by a contrived
 * one, and that an ordinary document never comes near one.
 */
import { createRenderContext } from '../binding/render-context';
import { paginate } from './paginate';
import { DEFAULT_LAYOUT_LIMITS, LayoutLimitError, resolveLimits } from './limits';
import type { PdfTemplate } from '../model/template';

const PAGE = {
  size: 'A4',
  orientation: 'portrait',
  margins: { top: 36, right: 36, bottom: 36, left: 36 },
  direction: 'rtl',
  locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
  unit: 'pt',
} as const;

/** A detail band over `items`, with `fields` copies of `expr` on every row. */
function rowsTemplate(expr: string, fields = 1): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'rows' },
    page: PAGE,
    styles: [],
    datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
    parameters: [],
    bands: [
      {
        id: 'd',
        type: 'detail',
        dataset: 'items',
        height: { mode: 'fixed', value: 20 },
        elements: Array.from({ length: fields }, (_, i) => ({
          id: 'f' + i,
          type: 'dataField',
          bounds: { x: i * 100, y: 0, width: 90, height: 16 },
          zIndex: 1,
          value: { source: expr },
        })),
      },
    ],
    resources: { fonts: [], images: [] },
  } as unknown as PdfTemplate;
}

const items = (n: number): Record<string, unknown>[] =>
  Array.from({ length: n }, (_, i) => ({ n: i, p: i * 13 }));

const run = (
  template: PdfTemplate,
  data: Record<string, unknown>,
  limits?: Parameters<typeof paginate>[2] extends { limits?: infer L } ? L : never,
): ReturnType<typeof paginate> =>
  paginate(template, createRenderContext({ data }), limits ? { limits } : {});

describe('resolveLimits', () => {
  it('fills every ceiling from the defaults', () => {
    expect(resolveLimits(undefined)).toEqual(DEFAULT_LAYOUT_LIMITS);
  });

  it('overrides only what was given', () => {
    const limits = resolveLimits({ maxPages: 3 });
    expect(limits.maxPages).toBe(3);
    expect(limits.maxRows).toBe(DEFAULT_LAYOUT_LIMITS.maxRows);
  });
});

describe('maxRows', () => {
  it('refuses a dataset larger than the ceiling', () => {
    const template = rowsTemplate('n');
    expect(() => run(template, { items: items(50) }, { maxRows: 10 })).toThrow(LayoutLimitError);
  });

  it('names the dataset and the count, so the limit is actionable', () => {
    try {
      run(rowsTemplate('n'), { items: items(50) }, { maxRows: 10 });
      throw new Error('expected a LayoutLimitError');
    } catch (err) {
      const limitErr = err as LayoutLimitError;
      expect(limitErr.limit).toBe('rows');
      expect(limitErr.max).toBe(10);
      expect(limitErr.message).toContain("'items'");
      expect(limitErr.message).toContain('50');
    }
  });

  it('allows a dataset exactly at the ceiling', () => {
    // an off-by-one here would reject the largest document a service advertises
    expect(() => run(rowsTemplate('n'), { items: items(10) }, { maxRows: 10 })).not.toThrow();
  });
});

describe('maxPages', () => {
  it('refuses a document that paginates past the ceiling', () => {
    // 400 rows at 20pt each is far more than an A4 page holds
    expect(() => run(rowsTemplate('n'), { items: items(400) }, { maxPages: 2 })).toThrow(
      LayoutLimitError,
    );
  });

  it('reports which budget ran out', () => {
    try {
      run(rowsTemplate('n'), { items: items(400) }, { maxPages: 2 });
      throw new Error('expected a LayoutLimitError');
    } catch (err) {
      expect((err as LayoutLimitError).limit).toBe('pages');
      expect((err as LayoutLimitError).max).toBe(2);
    }
  });
});

describe('maxExpressionSteps', () => {
  const RUNNING_TOTAL = "sum(slice($root.items, 0, $index + 1), 'p')";

  it('refuses a document whose expressions cost more than the budget', () => {
    // The documented running-total idiom, which is O(n²) — the exact shape that
    // makes a small body expensive, and the reason this budget exists.
    expect(() =>
      run(rowsTemplate(RUNNING_TOTAL, 3), { items: items(200) }, { maxExpressionSteps: 5_000 }),
    ).toThrow(LayoutLimitError);
  });

  it('is shared across expressions rather than reset per expression', () => {
    // Each expression here is trivially cheap and nowhere near the evaluator's
    // own 100k per-expression cap; only the total notices.
    expect(() =>
      run(rowsTemplate('n', 4), { items: items(500) }, { maxExpressionSteps: 200 }),
    ).toThrow(LayoutLimitError);
  });

  it('reports which budget ran out and where', () => {
    try {
      run(rowsTemplate('n', 4), { items: items(500) }, { maxExpressionSteps: 200 });
      throw new Error('expected a LayoutLimitError');
    } catch (err) {
      const limitErr = err as LayoutLimitError;
      expect(limitErr.limit).toBe('expressionSteps');
      expect(limitErr.message).toContain("band 'd'");
    }
  });
});

describe('an ordinary document', () => {
  it('paginates with the defaults untouched', () => {
    // The limits must be invisible to anyone who is not attacking the engine.
    const doc = run(rowsTemplate("sum(slice($root.items, 0, $index + 1), 'p')", 3), {
      items: items(120),
    });
    expect(doc.pageCount).toBeGreaterThan(1);
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('does not spend budget it was not given, so output stays byte-identical', () => {
    // Determinism is the engine's central promise: adding a counter must not
    // change a single decision when the budget is never reached.
    const template = rowsTemplate("sum(slice($root.items, 0, $index + 1), 'p')", 2);
    const withDefaults = run(template, { items: items(60) });
    const withHuge = run(template, { items: items(60) }, { maxExpressionSteps: 1_000_000_000 });
    expect(JSON.stringify(withHuge.pages)).toEqual(JSON.stringify(withDefaults.pages));
  });
});
