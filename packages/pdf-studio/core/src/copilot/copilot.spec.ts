import { extractJson, generateTemplate } from './generate';
import type { CopilotMessage, CopilotProvider } from './provider';
import { serializeTemplate } from '../serialization/serialize';
import type { PdfTemplate } from '../model/template';

const VALID: PdfTemplate = {
  schemaVersion: '1.0.0',
  metadata: { name: 'از کوپایلوت' },
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
    direction: 'rtl',
    locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
    unit: 'pt',
  },
  styles: [],
  datasets: [],
  parameters: [],
  bands: [
    {
      id: 'main',
      type: 'reportHeader',
      height: { mode: 'fixed', value: 100 },
      elements: [
        {
          id: 'title',
          type: 'staticText',
          bounds: { x: 0, y: 0, width: 300, height: 24 },
          zIndex: 1,
          text: 'سلام کوپایلوت',
        },
      ],
    },
  ],
  resources: { fonts: [], images: [] },
};
const VALID_JSON = serializeTemplate(VALID);

/** Provider that replays scripted replies and records what it was asked. */
function scripted(replies: string[]): CopilotProvider & { calls: CopilotMessage[][] } {
  let i = 0;
  const calls: CopilotMessage[][] = [];
  return {
    calls,
    complete: async (_system, messages) => {
      calls.push(messages.map((m) => ({ ...m })));
      return replies[Math.min(i++, replies.length - 1)] as string;
    },
  };
}

describe('extractJson', () => {
  it('takes fenced JSON out of prose', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\nDone.')).toBe('{"a":1}');
  });
  it('takes the outermost braces without fences', () => {
    expect(extractJson('here {"a":{"b":2}} tail')).toBe('{"a":{"b":2}}');
  });
  it('returns null when no object exists', () => {
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('generateTemplate — validate→repair loop (ROADMAP ۳.۱)', () => {
  it('returns a validated template on the first good reply', async () => {
    const provider = scripted([VALID_JSON]);
    const res = await generateTemplate({ prompt: 'یک قالب بساز', provider });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.template.metadata.name).toBe('از کوپایلوت');
      expect(res.attempts).toBe(1);
    }
  });

  it('feeds validation issues back and succeeds on repair', async () => {
    // an element missing its required bounds fails zod validation
    const broken = VALID_JSON.replace(/"bounds":\s*\{[^}]*\},/, '');
    const provider = scripted([broken, VALID_JSON]);
    const res = await generateTemplate({ prompt: 'بساز', provider });
    expect(res.success).toBe(true);
    if (res.success) expect(res.attempts).toBe(2);
    // the repair request carried the validation issue back to the model
    const repairMsg = provider.calls[1]!.at(-1)!.content;
    expect(repairMsg).toContain('failed validation');
    expect(repairMsg.toLowerCase()).toContain('bound');
  });

  it('gives up after maxRepairs with the last issues', async () => {
    const provider = scripted(['garbage, not json at all']);
    const res = await generateTemplate({ prompt: 'بساز', provider, maxRepairs: 1 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.attempts).toBe(2);
      expect(res.error).toContain('no JSON');
    }
  });

  it('includes the current template and sample data in the request when modifying', async () => {
    const provider = scripted([VALID_JSON]);
    await generateTemplate({
      prompt: 'رنگ تیتر را آبی کن',
      currentTemplate: VALID,
      sampleData: { customer: { name: 'x' } },
      provider,
    });
    const firstUser = provider.calls[0]![0]!.content;
    expect(firstUser).toContain('رنگ تیتر را آبی کن');
    expect(firstUser).toContain('Current template');
    expect(firstUser).toContain('Sample data');
    expect(firstUser).toContain('سلام کوپایلوت');
  });

  it('surfaces provider failures as errors, not throws', async () => {
    const provider: CopilotProvider = {
      complete: async () => {
        throw new Error('network down');
      },
    };
    const res = await generateTemplate({ prompt: 'بساز', provider });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain('network down');
  });
});
