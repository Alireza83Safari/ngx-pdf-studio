import type { Band } from '../model/band';
import type { DatasetDef } from '../model/dataset';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };
const itemsDataset: DatasetDef = { name: 'items', source: { kind: 'path', path: 'items' } };

function template(bands: Band[]): PdfTemplate {
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
    datasets: [itemsDataset],
    parameters: [],
    bands,
    resources: { fonts: [], images: [] },
  };
}

const txtField = (id: string, source: string): Band['elements'][number] => ({
  id,
  type: 'dataField',
  bounds: { x: 0, y: 0, width: 200, height: 16 },
  zIndex: 1,
  value: { source },
});

const groupHeader = (level: number, key: string, fieldSource: string): Band => ({
  id: 'gh' + level,
  type: 'groupHeader',
  groupLevel: level,
  groupKey: { source: key },
  height: { mode: 'fixed', value: 16 },
  elements: [txtField('gh' + level + '-f', fieldSource)],
});
const groupFooter = (level: number, fieldSource: string): Band => ({
  id: 'gf' + level,
  type: 'groupFooter',
  groupLevel: level,
  height: { mode: 'fixed', value: 16 },
  elements: [txtField('gf' + level + '-f', fieldSource)],
});
const detail = (fieldSource: string): Band => ({
  id: 'd',
  type: 'detail',
  dataset: 'items',
  height: { mode: 'fixed', value: 16 },
  elements: [txtField('d-f', fieldSource)],
});

const flowTexts = (tpl: PdfTemplate, data: Record<string, unknown>): (string | undefined)[] =>
  layoutDocument(tpl, { data }).pages[0]!.elements.map((e) => e.text);

describe('grouping (§6, §11A-D)', () => {
  const DATA = {
    items: [
      { cat: 'A', amount: 10 },
      { cat: 'A', amount: 20 },
      { cat: 'B', amount: 5 },
    ],
  };

  it('emits groupHeader → detail rows → groupFooter per group, with group aggregates', () => {
    const tpl = template([
      groupHeader(0, 'cat', '$groupKey'),
      detail('amount'),
      groupFooter(0, 'sum($group, amount)'),
    ]);
    // A header, 10, 20, A-sum=30, B header, 5, B-sum=5
    expect(flowTexts(tpl, DATA)).toEqual(['A', '10', '20', '30', 'B', '5', '5']);
  });

  it('exposes $groupIndex to the group header', () => {
    const tpl = template([groupHeader(0, 'cat', '$groupIndex'), detail('amount')]);
    const texts = flowTexts(tpl, DATA).filter((t) => t === '0' || t === '1');
    expect(texts).toEqual(['0', '1']); // two groups → indices 0,1
  });

  it('supports multi-level grouping', () => {
    const data = {
      items: [
        { region: 'N', cat: 'A', amount: 1 },
        { region: 'N', cat: 'B', amount: 2 },
        { region: 'S', cat: 'A', amount: 3 },
      ],
    };
    const tpl = template([
      groupHeader(0, 'region', "concat('R:', $groupKey)"),
      groupHeader(1, 'cat', "concat('C:', $groupKey)"),
      detail('amount'),
    ]);
    // R:N, C:A, 1, C:B, 2, R:S, C:A, 3
    expect(flowTexts(tpl, data)).toEqual(['R:N', 'C:A', '1', 'C:B', '2', 'R:S', 'C:A', '3']);
  });

  it('still works (ungrouped) when no group bands are present', () => {
    const tpl = template([detail('amount')]);
    expect(flowTexts(tpl, DATA)).toEqual(['10', '20', '5']);
  });
});
