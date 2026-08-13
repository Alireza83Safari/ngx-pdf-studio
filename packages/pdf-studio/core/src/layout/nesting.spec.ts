/**
 * Recursion guards for composite elements.
 *
 * Layout descends once per nesting level and validation's schema does the same,
 * so deep enough input exhausts the call stack before any budget notices — the
 * failure arrives as a raw `RangeError`, which names no element, no template and
 * no limit, and is thrown into a consumer's app by two modules that both promise
 * structured failures instead.
 *
 * A self-referencing subreport is worse than deep: it has no bottom at all.
 */
import { createRenderContext } from '../binding/render-context';
import { importTemplate } from '../serialization/serialize';
import { validateTemplate } from '../validation/validate';
import { LayoutLimitError } from './limits';
import { paginate, type SubreportTemplate } from './paginate';
import type { AnyElement } from '../model/elements';
import type { PdfTemplate } from '../model/template';

const PAGE = {
  size: 'A4',
  orientation: 'portrait',
  margins: { top: 36, right: 36, bottom: 36, left: 36 },
  direction: 'rtl',
  locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
  unit: 'pt',
} as const;

const BOX = { x: 0, y: 0, width: 100, height: 20 };

const leaf = (): AnyElement =>
  ({ id: 'leaf', type: 'staticText', bounds: BOX, zIndex: 1, text: 'x' }) as unknown as AnyElement;

/** `depth` containers wrapped around one text element. */
function nested(depth: number): AnyElement {
  let el = leaf();
  for (let i = 0; i < depth; i++) {
    el = {
      id: 'c' + i,
      type: 'container',
      bounds: BOX,
      zIndex: 1,
      children: [el],
    } as unknown as AnyElement;
  }
  return el;
}

function withElement(el: AnyElement): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'nesting' },
    page: PAGE,
    styles: [],
    datasets: [],
    parameters: [],
    bands: [
      {
        id: 'b',
        type: 'reportHeader',
        height: { mode: 'fixed', value: 60 },
        elements: [el],
      },
    ],
    resources: { fonts: [], images: [] },
  } as unknown as PdfTemplate;
}

describe('validation refuses input too deep for its own schema', () => {
  it('returns issues instead of throwing a RangeError', () => {
    // Measured on the unguarded code: 2000 containers is a 203 KiB template —
    // under any plausible request-size limit — and `importTemplate` threw
    // `RangeError: Maximum call stack size exceeded` out of `safeParse`.
    const json = JSON.stringify(withElement(nested(2000)));
    expect(json.length).toBeLessThan(1024 * 1024);

    let result: ReturnType<typeof importTemplate> | undefined;
    expect(() => {
      result = importTemplate(json);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it('says that depth was the problem, rather than guessing at a field', () => {
    const result = validateTemplate(withElement(nested(2000)));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.message).toMatch(/nesting exceeds the maximum depth/);
  });

  it('accepts nesting a person would actually author', () => {
    const result = validateTemplate(withElement(nested(8)));
    expect(result.success).toBe(true);
  });

  it('terminates on a cyclic object rather than walking it forever', () => {
    // `validateTemplate` takes `unknown`, and not every caller arrives via
    // JSON.parse — the depth bound is what makes a cycle finite.
    const cyclic: Record<string, unknown> = { schemaVersion: '1.0.0' };
    cyclic.self = cyclic;
    expect(() => validateTemplate(cyclic)).not.toThrow();
    expect(validateTemplate(cyclic).success).toBe(false);
  });
});

describe('layout refuses to recurse past its ceiling', () => {
  const run = (template: PdfTemplate, options = {}): ReturnType<typeof paginate> =>
    paginate(template, createRenderContext({}), options);

  it('stops on containers nested past maxNestingDepth', () => {
    expect(() => run(withElement(nested(40)), { limits: { maxNestingDepth: 8 } })).toThrow(
      LayoutLimitError,
    );
  });

  it('names the element and the limit', () => {
    try {
      run(withElement(nested(40)), { limits: { maxNestingDepth: 8 } });
      throw new Error('expected a LayoutLimitError');
    } catch (err) {
      const limitErr = err as LayoutLimitError;
      expect(limitErr.limit).toBe('nesting');
      expect(limitErr.max).toBe(8);
      expect(limitErr.message).toContain('container');
    }
  });

  it('lays out nesting within the ceiling untouched', () => {
    const doc = run(withElement(nested(4)));
    // one leaf plus its four container boxes
    expect(doc.pages[0]?.elements.length).toBe(5);
  });

  it('stops a subreport that embeds itself, which has no natural bottom', () => {
    // No budget catches this one: it is not expensive, it is endless. Without
    // the guard the stack gives way and a RangeError escapes instead.
    const selfReferential: Record<string, SubreportTemplate> = {
      loop: {
        bands: [
          {
            id: 'sb',
            type: 'detail',
            height: { mode: 'fixed', value: 20 },
            elements: [
              {
                id: 'inner',
                type: 'subreport',
                bounds: BOX,
                zIndex: 1,
                templateRef: 'loop',
                dataset: { source: '$root' },
              },
            ],
          },
        ],
      } as unknown as SubreportTemplate,
    };
    const template = withElement({
      id: 'outer',
      type: 'subreport',
      bounds: BOX,
      zIndex: 1,
      templateRef: 'loop',
      dataset: { source: '$root' },
    } as unknown as AnyElement);

    expect(() => run(template, { subreports: selfReferential })).toThrow(LayoutLimitError);
    try {
      run(template, { subreports: selfReferential });
    } catch (err) {
      expect((err as LayoutLimitError).limit).toBe('nesting');
    }
  });
});
