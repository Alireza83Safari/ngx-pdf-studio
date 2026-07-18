import {
  extractJson,
  generateTemplate,
  outOfBoundsIssues,
  TEMPLATE_CONTRACT,
  TEMPLATE_EXAMPLE,
} from './generate';
import { OpenAICompatibleProvider } from './provider';
import type { CopilotMessage, CopilotProvider } from './provider';
import { importTemplate, serializeTemplate } from '../serialization/serialize';
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

describe('TEMPLATE_CONTRACT few-shot (ROADMAP ۳.۱)', () => {
  it('teaches the model a template that actually validates', () => {
    // the worked example we show the model must itself pass import validation,
    // so the few-shot can never drift out of sync with the schema
    const res = importTemplate(JSON.stringify(TEMPLATE_EXAMPLE));
    expect(res.success).toBe(true);
  });

  it('embeds the worked example inside the contract', () => {
    expect(TEMPLATE_CONTRACT).toContain('COMPLETE EXAMPLE');
    expect(TEMPLATE_CONTRACT).toContain('"pageField"');
    expect(TEMPLATE_CONTRACT).toContain('toWords');
    // the example JSON is spliced in verbatim
    expect(TEMPLATE_CONTRACT).toContain('"schemaVersion":"1.0.0"');
  });
});

describe('outOfBoundsIssues (layout guardrail)', () => {
  it('passes a template whose elements all fit the page', () => {
    expect(outOfBoundsIssues(TEMPLATE_EXAMPLE as unknown as PdfTemplate)).toEqual([]);
    expect(outOfBoundsIssues(VALID)).toEqual([]);
  });

  it('flags an element that runs off the right edge', () => {
    const bad = JSON.parse(VALID_JSON) as PdfTemplate;
    bad.bands[0]!.elements[0]!.bounds = { x: 0, y: 0, width: 600, height: 24 };
    const issues = outOfBoundsIssues(bad);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/right edge/);
  });

  it('flags an element that spills below a fixed band', () => {
    const bad = JSON.parse(VALID_JSON) as PdfTemplate;
    bad.bands[0]!.elements[0]!.bounds = { x: 0, y: 90, width: 100, height: 40 }; // band is 100 tall
    const issues = outOfBoundsIssues(bad);
    expect(issues.some((i) => /below the band/.test(i))).toBe(true);
  });
});

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

  it('repairs a valid-but-off-page template through the bounds guardrail', async () => {
    const overflow = JSON.parse(VALID_JSON) as PdfTemplate;
    overflow.bands[0]!.elements[0]!.bounds = { x: 0, y: 0, width: 600, height: 24 };
    const provider = scripted([JSON.stringify(overflow), VALID_JSON]);
    const res = await generateTemplate({ prompt: 'بساز', provider });
    expect(res.success).toBe(true);
    if (res.success) expect(res.attempts).toBe(2);
    // the second request explained the overflow
    expect(provider.calls[1]!.at(-1)!.content).toContain('OUTSIDE the page');
  });

  it('accepts an off-page template rather than failing once repairs run out', async () => {
    const overflow = JSON.parse(VALID_JSON) as PdfTemplate;
    overflow.bands[0]!.elements[0]!.bounds = { x: 0, y: 0, width: 600, height: 24 };
    const provider = scripted([JSON.stringify(overflow)]); // never fixes it
    const res = await generateTemplate({ prompt: 'بساز', provider, maxRepairs: 1 });
    // a slightly-overflowing template still beats no result
    expect(res.success).toBe(true);
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

/** fetch stub that records requests and replays canned responses in order. */
function fakeFetchSeq(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => null },
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      json: async () => r.body,
    } as unknown as Response;
  }) as typeof fetch;
  return { impl, calls };
}
/** Single-response shorthand. */
function fakeFetch(status: number, body: unknown) {
  return fakeFetchSeq([{ status, body }]);
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
    // free tiers count max_tokens toward the minute budget — omit unless asked for
    expect(sent.max_tokens).toBeUndefined();
    // keyless local server → no Authorization header
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('sends max_tokens only when configured', async () => {
    const { impl, calls } = fakeFetch(200, reply);
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://x/v1',
      model: 'm',
      maxTokens: 4096,
      fetchImpl: impl,
    });
    await provider.complete('sys', [{ role: 'user', content: 'hi' }]);
    expect(JSON.parse(calls[0]!.init.body as string).max_tokens).toBe(4096);
  });

  it('waits out a short 429 and retries once', async () => {
    const { impl, calls } = fakeFetchSeq([
      {
        status: 429,
        body: { error: { message: 'Rate limit reached. Please try again in 12ms.' } },
      },
      { status: 200, body: reply },
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://x/v1',
      model: 'm',
      fetchImpl: impl,
    });
    await expect(provider.complete('sys', [{ role: 'user', content: 'hi' }])).resolves.toBe(
      'سلام از مدل',
    );
    expect(calls.length).toBe(2);
  });

  it('does not retry a 429 that asks for a long wait', async () => {
    const { impl, calls } = fakeFetchSeq([
      {
        status: 429,
        body: { error: { message: 'Rate limit reached. Please try again in 2m59.56s.' } },
      },
      { status: 200, body: reply },
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://x/v1',
      model: 'm',
      fetchImpl: impl,
    });
    await expect(provider.complete('sys', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /429/,
    );
    expect(calls.length).toBe(1);
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

  it('calls the default fetch bound, like browsers require', async () => {
    // browsers throw "Illegal invocation" when fetch runs with a foreign `this`;
    // Node's fetch does not care, so emulate the check to guard the .bind()
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return fakeFetch(200, { choices: [{ message: { content: 'ok' } }] }).impl(...args);
    } as typeof fetch;
    try {
      const provider = new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: 'm' });
      await expect(provider.complete('sys', [{ role: 'user', content: 'hi' }])).resolves.toBe('ok');
    } finally {
      globalThis.fetch = original;
    }
  });
});
