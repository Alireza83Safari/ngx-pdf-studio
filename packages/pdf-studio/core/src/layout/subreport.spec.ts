import { createRenderContext } from '../binding/render-context';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { paginate, type SubreportTemplate } from './paginate';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function template(el: AnyElement): PdfTemplate {
  return {
    schemaVersion: '1.0.0',
    metadata: { name: 't' },
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
    bands: [
      { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 200 }, elements: [el] },
    ],
    resources: { fonts: [], images: [] },
  };
}

const subreportEl: AnyElement = {
  id: 'sub',
  type: 'subreport',
  bounds: { x: 30, y: 50, width: 300, height: 100 },
  zIndex: 1,
  templateRef: 'lines',
  dataset: { source: 'order' },
};

// Sub-template: a title + one detail row per line item.
const linesSubreport: SubreportTemplate = {
  datasets: [{ name: 'lines', source: { kind: 'path', path: 'lines' } }],
  bands: [
    {
      id: 'sh',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 18 },
      elements: [
        {
          id: 'title',
          type: 'dataField',
          bounds: { x: 0, y: 0, width: 200, height: 16 },
          zIndex: 1,
          value: { source: 'title' },
        },
      ],
    },
    {
      id: 'sd',
      type: 'detail',
      dataset: 'lines',
      height: { mode: 'fixed', value: 16 },
      elements: [
        {
          id: 'line',
          type: 'dataField',
          bounds: { x: 0, y: 0, width: 200, height: 16 },
          zIndex: 1,
          value: { source: 'name' },
        },
      ],
    },
  ],
};

const DATA = {
  order: { title: 'Order #42', lines: [{ name: 'Widget' }, { name: 'Gadget' }, { name: 'Gizmo' }] },
};

describe('subreport (§5)', () => {
  it('embeds the sub-template, resolving its data and iterating its detail rows', () => {
    const els = paginate(template(subreportEl), createRenderContext({ data: DATA }), {
      subreports: { lines: linesSubreport },
    }).pages[0]!.elements;
    const texts = els.map((e) => e.text);
    expect(texts).toContain('Order #42'); // sub report header bound to order.title
    expect(texts).toEqual(expect.arrayContaining(['Widget', 'Gadget', 'Gizmo'])); // 3 detail rows
  });

  it('offsets the embedded content into the subreport bounds', () => {
    const els = paginate(template(subreportEl), createRenderContext({ data: DATA }), {
      subreports: { lines: linesSubreport },
    }).pages[0]!.elements;
    const title = els.find((e) => e.text === 'Order #42')!;
    // page margin (20) + subreport.x (30) = 50; subreport.y row at top of band.
    expect(title.bounds.x).toBe(20 + 30);
    expect(title.bounds.y).toBe(20 + 50);
  });

  it('warns when the subreport template is not registered', () => {
    const doc = paginate(template(subreportEl), createRenderContext({ data: DATA }), {});
    expect(
      doc.diagnostics.some((d) => /Subreport template 'lines' is not registered/.test(d.message)),
    ).toBe(true);
  });
});
