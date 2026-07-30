import { createRenderContext } from '../binding/render-context';
import type { Band } from '../model/band';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { paginate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function template(bands: Band[]): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 'x' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      direction: 'ltr',
      locale: EN,
      unit: 'pt',
    },
    styles: [],
    datasets: [],
    parameters: [],
    bands,
    resources: { fonts: [], images: [] },
  };
}

const text = (id: string, t: string): Band['elements'][number] => ({
  id,
  type: 'staticText',
  bounds: { x: 0, y: 0, width: 100, height: 16 },
  zIndex: 1,
  text: t,
});

describe('pagination engine — additional bands & sources', () => {
  it('places report header/footer once, watermark/background on the page', () => {
    const doc = paginate(
      template([
        {
          id: 'wm',
          type: 'watermark',
          height: { mode: 'fixed', value: 0 },
          elements: [text('w', 'WM')],
        },
        {
          id: 'rh',
          type: 'reportHeader',
          height: { mode: 'fixed', value: 20 },
          elements: [text('rh', 'RH')],
        },
        {
          id: 'rf',
          type: 'reportFooter',
          height: { mode: 'fixed', value: 20 },
          elements: [text('rf', 'RF')],
        },
      ]),
      createRenderContext({ data: {} }),
    );
    expect(doc.pageCount).toBe(1);
    const ids = doc.pages[0]!.elements.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['w', 'rh', 'rf']));
  });

  it('warns about unsupported band types but keeps rendering', () => {
    const ctx = createRenderContext({ data: {} });
    paginate(
      template([
        { id: 'ch', type: 'columnHeader', height: { mode: 'fixed', value: 20 }, elements: [] },
      ]),
      ctx,
    );
    expect(ctx.diagnostics.some((d) => /not yet supported/.test(d.message))).toBe(true);
  });

  describe('band overflow (designer-ux 0.1)', () => {
    const at = (id: string, y: number): Band['elements'][number] => ({
      ...text(id, id),
      bounds: { x: 0, y, width: 100, height: 16 },
    });
    const overflow = (ctx: ReturnType<typeof createRenderContext>) =>
      ctx.diagnostics.filter((d) => /the overflow is painted over/.test(d.message));

    it('warns when a fixed band paints below its own height', () => {
      const ctx = createRenderContext({ data: {} });
      paginate(
        template([
          { id: 'rh', type: 'reportHeader', height: { mode: 'fixed', value: 60 }, elements: [] },
          {
            id: 'rf',
            type: 'reportFooter',
            height: { mode: 'fixed', value: 60 },
            elements: [at('spill', 200)],
          },
        ]),
        ctx,
      );
      const [warning] = overflow(ctx);
      expect(warning?.severity).toBe('warning');
      // 60pt band, content bottom at 200 + 16
      expect(warning?.message).toContain("Band 'rf' is 60pt tall");
      expect(warning?.message).toContain('reaches 216pt');
    });

    it('stays silent when the content fits', () => {
      const ctx = createRenderContext({ data: {} });
      paginate(
        template([
          {
            id: 'rh',
            type: 'reportHeader',
            height: { mode: 'fixed', value: 60 },
            elements: [at('ok', 40)],
          },
        ]),
        ctx,
      );
      expect(overflow(ctx)).toEqual([]);
    });

    it('stays silent for an auto band, which grows to fit instead', () => {
      const ctx = createRenderContext({ data: {} });
      paginate(
        template([
          {
            id: 'rh',
            type: 'reportHeader',
            height: { mode: 'auto' },
            elements: [at('tall', 300)],
          },
        ]),
        ctx,
      );
      expect(overflow(ctx)).toEqual([]);
    });

    it('warns for an auto band whose max clamps the content away', () => {
      const ctx = createRenderContext({ data: {} });
      paginate(
        template([
          {
            id: 'rh',
            type: 'reportHeader',
            height: { mode: 'auto', max: 50 },
            elements: [at('tall', 300)],
          },
        ]),
        ctx,
      );
      expect(overflow(ctx)).toHaveLength(1);
    });

    it('exempts watermark and background bands, which span the page by design', () => {
      const ctx = createRenderContext({ data: {} });
      paginate(
        template([
          {
            id: 'wm',
            type: 'watermark',
            height: { mode: 'fixed', value: 0 },
            elements: [at('mark', 300)],
          },
          {
            id: 'bg',
            type: 'background',
            height: { mode: 'fixed', value: 0 },
            elements: [at('back', 500)],
          },
        ]),
        ctx,
      );
      expect(overflow(ctx)).toEqual([]);
    });

    it('reports one warning per band however many rows repeat it', () => {
      const ctx = createRenderContext({ data: { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] } });
      paginate(
        template([
          {
            id: 'd',
            type: 'detail',
            height: { mode: 'fixed', value: 20 },
            dataset: 'rows',
            elements: [at('spill', 90)],
          },
        ]),
        ctx,
      );
      expect(overflow(ctx)).toHaveLength(1);
    });
  });

  it('warns when a detail band references an undeclared dataset', () => {
    const ctx = createRenderContext({ data: { rows: [{ n: 1 }] } });
    paginate(
      template([
        {
          id: 'd',
          type: 'detail',
          height: { mode: 'fixed', value: 16 },
          dataset: 'rows',
          elements: [text('n', 'row')],
        },
      ]),
      ctx,
    );
    expect(ctx.diagnostics.some((d) => /Dataset 'rows' is not declared/.test(d.message))).toBe(
      true,
    );
  });

  it('resolves a currentDate page field from the injected clock', () => {
    const ctx = createRenderContext({ now: Date.parse('2026-06-24T00:00:00Z') });
    const doc = paginate(
      template([
        {
          id: 'f',
          type: 'pageFooter',
          height: { mode: 'fixed', value: 16 },
          elements: [
            {
              id: 'dt',
              type: 'pageField',
              bounds: { x: 0, y: 0, width: 100, height: 16 },
              zIndex: 1,
              field: 'currentDate',
              format: { kind: 'date', options: { pattern: 'yyyy-MM-dd' } },
            },
          ],
        },
      ]),
      ctx,
    );
    expect(doc.pages[0]!.elements.find((e) => e.id === 'dt')!.text).toBe('2026-06-24');
  });

  it('falls back to one empty row when a detail band has no dataset', () => {
    const doc = paginate(
      template([
        {
          id: 'd',
          type: 'detail',
          height: { mode: 'fixed', value: 16 },
          elements: [text('s', 'once')],
        },
      ]),
      createRenderContext({ data: {} }),
    );
    expect(doc.pages[0]!.elements.filter((e) => e.id === 's').length).toBe(1);
  });
});
