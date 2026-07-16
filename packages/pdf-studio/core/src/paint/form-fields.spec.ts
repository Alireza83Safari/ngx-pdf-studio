import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';
import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument, renderToPdf } from '../render';
import { paintToSvg } from './svg-painter';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

const fields: AnyElement[] = [
  {
    id: 'name',
    type: 'formField',
    fieldKind: 'text',
    fieldName: 'fullName',
    defaultValue: { source: "'Ada'" },
    bounds: { x: 0, y: 0, width: 150, height: 20 },
    zIndex: 1,
  } as AnyElement,
  {
    id: 'agree',
    type: 'formField',
    fieldKind: 'checkbox',
    fieldName: 'agree',
    defaultValue: { source: 'true' },
    bounds: { x: 0, y: 30, width: 16, height: 16 },
    zIndex: 1,
  } as AnyElement,
];

const fixture: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'form' },
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
    { id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 80 }, elements: fields },
  ],
  resources: { fonts: [], images: [] },
};

describe('AcroForm fillable fields (§11A-A)', () => {
  it('emits text and checkbox widgets (verified with pdfjs getFieldObjects)', async () => {
    const result = await renderToPdf(fixture);
    const pdf = await getDocument({ data: result.bytes, isEvalSupported: false }).promise;
    const objects = await pdf.getFieldObjects();
    expect(objects).not.toBeNull();
    expect(Object.keys(objects!).sort()).toEqual(['agree', 'fullName']);
  });

  it('renders preview placeholders in SVG (value text + checkbox tick)', () => {
    const doc = layoutDocument(fixture);
    const svg = paintToSvg(doc)[0]!;
    expect(svg).toContain('Ada'); // text field value placeholder
    expect(svg).toContain('<path'); // checked checkbox tick
  });

  it('warns on a duplicate field name rather than throwing', async () => {
    const dup: PdfTemplate = {
      ...fixture,
      bands: [
        {
          id: 'b',
          type: 'reportHeader',
          height: { mode: 'fixed', value: 80 },
          elements: [fields[0]!, { ...(fields[0] as AnyElement), id: 'name2' }],
        },
      ],
    };
    const result = await renderToPdf(dup);
    expect(result.diagnostics.some((d) => /form field 'fullName'/.test(d.message))).toBe(true);
  });
});
