import type { AnyElement } from '../model/elements';
import type { LocaleSetup } from '../model/locale';
import type { PdfTemplate } from '../model/template';
import { layoutDocument } from '../render';

const EN: LocaleSetup = { language: 'en', digits: 'latn', calendar: 'gregorian' };

function template(elements: AnyElement[]): PdfTemplate {
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
    bands: [{ id: 'b', type: 'reportHeader', height: { mode: 'fixed', value: 300 }, elements }],
    resources: { fonts: [], images: [] },
  };
}

const at = (id: string, x: number, y: number, text: string): AnyElement =>
  ({
    id,
    type: 'staticText',
    bounds: { x, y, width: 100, height: 16 },
    zIndex: 1,
    text,
  }) as AnyElement;

const els = (t: PdfTemplate) => layoutDocument(t).pages[0]!.elements;

describe('container nesting (§5)', () => {
  it('positions children relative to the container and emits the container box', () => {
    const container = {
      id: 'box',
      type: 'container',
      bounds: { x: 50, y: 40, width: 200, height: 100 },
      zIndex: 1,
      box: { fill: { color: { space: 'rgb', r: 240, g: 240, b: 240 } } },
      children: [at('child', 10, 10, 'inside')],
    } as AnyElement;

    const out = els(template([container]));
    // page content origin is (20,20); container at (50,40) → absolute (70,60).
    expect(out.find((e) => e.id === 'box')).toBeDefined();
    const child = out.find((e) => e.id === 'child')!;
    expect(child.text).toBe('inside');
    expect(child.bounds.x).toBe(20 + 50 + 10); // page margin + container x + child x
    expect(child.bounds.y).toBe(20 + 40 + 10);
  });

  it('supports nested containers (offsets compound)', () => {
    const inner = {
      id: 'inner',
      type: 'container',
      bounds: { x: 5, y: 5, width: 80, height: 40 },
      zIndex: 1,
      children: [at('leaf', 2, 2, 'deep')],
    } as AnyElement;
    const outer = {
      id: 'outer',
      type: 'container',
      bounds: { x: 30, y: 30, width: 150, height: 80 },
      zIndex: 1,
      children: [inner],
    } as AnyElement;

    const leaf = els(template([outer])).find((e) => e.id === 'leaf')!;
    // 20 (margin) + 30 (outer) + 5 (inner) + 2 (leaf)
    expect(leaf.bounds.x).toBe(57);
    expect(leaf.bounds.y).toBe(57);
  });

  it('hides a container child when its visibleWhen is false', () => {
    const container = {
      id: 'box',
      type: 'container',
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      zIndex: 1,
      children: [{ ...at('hidden', 0, 0, 'x'), visibleWhen: { source: 'false' } }],
    } as AnyElement;
    expect(els(template([container])).some((e) => e.id === 'hidden')).toBe(false);
  });
});
