/**
 * Photo → template (F4.1). A PDF carries its own text runs; a photo does not,
 * so a vision provider stands in for the extractor and everything downstream is
 * reused. These tests script the provider so no network or key is involved.
 */
import { cloneFormatImage, imageToPage } from './image-import';
import type { CopilotMessage, CopilotProvider, VisionImage } from '../copilot/provider';

const IMAGE: VisionImage = { base64: 'AAAA', mime: 'image/png' };

/** A provider that replies with a canned string and records what it was sent. */
const scripted = (
  reply: string | (() => never),
): CopilotProvider & { seen: CopilotMessage[]; system: string } => {
  const rec = {
    seen: [] as CopilotMessage[],
    system: '',
    async complete(system: string, messages: CopilotMessage[]): Promise<string> {
      rec.system = system;
      rec.seen = messages;
      if (typeof reply !== 'string') reply();
      return reply;
    },
  };
  return rec;
};

const runs = (...items: unknown[]) => JSON.stringify({ runs: items });

describe('imageToPage (F4.1)', () => {
  it('sends the image alongside the contract', async () => {
    const vision = scripted(runs());
    await imageToPage(IMAGE, vision);
    expect(vision.seen[0]!.image).toEqual(IMAGE);
    expect(vision.system).toContain('0-1000 grid');
  });

  it('scales the normalised grid onto the page and flips y to a PDF baseline', async () => {
    const vision = scripted(runs({ text: 'Invoice', x: 0, y: 0, w: 500, h: 1000 }));
    const page = await imageToPage(IMAGE, vision, { pageWidth: 1000, pageHeight: 1000 });
    const run = page.texts[0]!;
    expect(run.x).toBe(0);
    expect(run.width).toBe(500);
    expect(run.fontSize).toBe(1000);
    // top of the grid, so the baseline sits a full font size below the page top
    expect(run.y).toBe(0);
  });

  it('defaults to A4 when no page size is given', async () => {
    const page = await imageToPage(IMAGE, scripted(runs()));
    expect(page.width).toBeCloseTo(595.28, 2);
    expect(page.height).toBeCloseTo(841.89, 2);
  });

  it('carries the run direction through', async () => {
    const vision = scripted(
      runs(
        { text: 'فاکتور', x: 10, y: 10, w: 100, h: 20, rtl: true },
        { text: 'INV-1', x: 10, y: 40, w: 100, h: 20 },
      ),
    );
    const page = await imageToPage(IMAGE, vision);
    expect(page.texts.map((t) => t.dir)).toEqual(['rtl', 'ltr']);
  });

  it('drops runs it cannot place rather than guessing coordinates', async () => {
    const vision = scripted(
      runs(
        { text: 'good', x: 1, y: 1, w: 10, h: 10 },
        { text: 'no box' },
        { x: 1, y: 1, w: 10, h: 10 },
        { text: '   ', x: 1, y: 1, w: 10, h: 10 },
      ),
    );
    const page = await imageToPage(IMAGE, vision);
    expect(page.texts.map((t) => t.text)).toEqual(['good']);
    expect(page.warnings.join(' ')).toContain('3 unreadable run(s) dropped');
  });

  it('reports an unreadable image instead of throwing', async () => {
    const page = await imageToPage(IMAGE, scripted(runs()));
    expect(page.texts).toEqual([]);
    expect(page.warnings.join(' ')).toContain('no text recovered');
  });

  it('survives malformed JSON', async () => {
    const page = await imageToPage(IMAGE, scripted('sorry, I cannot read that'));
    expect(page.texts).toEqual([]);
    expect(page.warnings.join(' ')).toContain('did not return a readable run list');
  });

  it('survives a provider that throws', async () => {
    const page = await imageToPage(
      IMAGE,
      scripted(() => {
        throw new Error('402 payment required');
      }),
    );
    expect(page.texts).toEqual([]);
    expect(page.warnings.join(' ')).toContain('402 payment required');
  });
});

describe('cloneFormatImage (F4.1)', () => {
  it('binds a photographed invoice through the existing pipeline', async () => {
    // a header label:value pair plus two aligned item rows
    const vision = scripted(
      runs(
        { text: 'Invoice No:', x: 40, y: 30, w: 120, h: 20 },
        { text: 'INV-1024', x: 200, y: 30, w: 100, h: 20 },
        { text: 'Item', x: 40, y: 120, w: 80, h: 18 },
        { text: 'Qty', x: 400, y: 120, w: 60, h: 18 },
        { text: 'widget', x: 40, y: 160, w: 80, h: 18 },
        { text: '2', x: 400, y: 160, w: 60, h: 18 },
        { text: 'gadget', x: 40, y: 200, w: 80, h: 18 },
        { text: '5', x: 400, y: 200, w: 60, h: 18 },
      ),
    );
    const result = await cloneFormatImage(IMAGE, { vision, name: 'photo' });
    expect(result.template.metadata.name).toBe('photo');
    // the header value became a bound field, not static text
    expect(result.schema.fields.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.inferredData)).toContain('INV-1024');
  });

  it("surfaces the image-reading warnings alongside the clone's own", async () => {
    const result = await cloneFormatImage(IMAGE, { vision: scripted(runs()), name: 'blank' });
    expect(result.warnings.join(' ')).toContain('no text recovered');
  });
});
