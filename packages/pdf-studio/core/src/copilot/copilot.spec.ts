import { extractJson, generateTemplate } from './generate';
import { OpenAICompatibleProvider } from './provider';
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

/** fetch stub that records the request and replies with a canned body. */
function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

describe('OpenAICompatibleProvider (Ollama/Groq/Gemini/OpenRouter)', () => {
  const reply = { choices: [{ message: { content: 'سلام از مدل' } }] };

  it('speaks the /chat/completions shape with the system prompt first', async () => {
    const { impl, calls } = fakeFetch(200, reply);
    // trailing slash on baseUrl must not produce a double slash
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1/',
      model: 'qwen2.5-coder:7b',
      fetchImpl: impl,
    });
    const text = await provider.complete('you are a copilot', [{ role: 'user', content: 'بساز' }]);

    expect(text).toBe('سلام از مدل');
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    const sent = JSON.parse(calls[0]!.init.body as string);
    expect(sent.model).toBe('qwen2.5-coder:7b');
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'you are a copilot' });
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'بساز' });
    // keyless local server → no Authorization header
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('sends a bearer token when a key is given', async () => {
    const { impl, calls } = fakeFetch(200, reply);
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      apiKey: 'gsk_test',
      fetchImpl: impl,
    });
    await provider.complete('sys', [{ role: 'user', content: 'hi' }]);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer gsk_test');
  });

  it('throws with the HTTP status on failure', async () => {
    const { impl } = fakeFetch(429, { error: 'rate limited' });
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'x',
      fetchImpl: impl,
    });
    await expect(provider.complete('sys', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /429/,
    );
  });

  it('throws when the reply carries no text', async () => {
    const { impl } = fakeFetch(200, { choices: [{ message: { content: '' } }] });
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://x/v1',
      model: 'm',
      fetchImpl: impl,
    });
    await expect(provider.complete('sys', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /no text/,
    );
  });
});
