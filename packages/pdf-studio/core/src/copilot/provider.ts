/**
 * Copilot providers (ROADMAP ۳.۱): the LLM behind the copilot is pluggable.
 * A provider only has to complete a chat — everything template-specific
 * (contract prompt, validation, repair) lives in `generate.ts`, so swapping
 * vendors or pointing at a local model never touches the pipeline.
 */

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotProvider {
  /** Complete a chat; returns the assistant's text. */
  complete(system: string, messages: CopilotMessage[]): Promise<string>;
}

export interface ClaudeProviderOptions {
  /** Anthropic API key — supplied by the end user at runtime, never bundled. */
  apiKey: string;
  /** Model id; defaults to the latest Sonnet. */
  model?: string;
  maxTokens?: number;
  /** Override for self-hosted gateways / tests. */
  baseUrl?: string;
  /** Injectable fetch for tests and non-standard runtimes. */
  fetchImpl?: typeof fetch;
}

/** Anthropic Messages API provider (browser-direct or Node ≥18). */
export class ClaudeProvider implements CopilotProvider {
  private readonly opts: Required<Omit<ClaudeProviderOptions, 'fetchImpl'>> & {
    fetchImpl: typeof fetch;
  };

  constructor(options: ClaudeProviderOptions) {
    this.opts = {
      apiKey: options.apiKey,
      model: options.model ?? 'claude-sonnet-5',
      maxTokens: options.maxTokens ?? 8192,
      baseUrl: options.baseUrl ?? 'https://api.anthropic.com',
      // bound: browsers throw "Illegal invocation" if fetch runs detached from window
      fetchImpl: options.fetchImpl ?? fetch.bind(globalThis),
    };
  }

  async complete(system: string, messages: CopilotMessage[]): Promise<string> {
    const res = await this.opts.fetchImpl(`${this.opts.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
        // allows keys scoped for browser use to call the API directly
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: this.opts.maxTokens,
        system,
        messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Claude API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    if (!text) throw new Error('Claude API returned no text content');
    return text;
  }
}

export interface OpenAICompatibleProviderOptions {
  /**
   * Base URL up to (not including) /chat/completions — include the service's
   * version prefix, matching the OpenAI-SDK convention:
   * Ollama http://localhost:11434/v1 · Groq https://api.groq.com/openai/v1 ·
   * Gemini https://generativelanguage.googleapis.com/v1beta/openai ·
   * OpenRouter https://openrouter.ai/api/v1
   */
  baseUrl: string;
  /** Model id as the service names it, e.g. "qwen2.5-coder:7b" or "llama-3.3-70b-versatile". */
  model: string;
  /** Bearer key; optional because local runtimes (Ollama, LM Studio) need none. */
  apiKey?: string;
  /**
   * When unset, max_tokens is omitted from the request: free tiers (Groq)
   * count it toward the per-minute token budget and pre-reject the request
   * when prompt + max_tokens exceeds the window.
   */
  maxTokens?: number;
  /** Injectable fetch for tests and non-standard runtimes. */
  fetchImpl?: typeof fetch;
}

/**
 * OpenAI-compatible chat-completions provider — the free-tier path: Groq and
 * Google AI Studio hand out free API keys, OpenRouter lists `:free` models,
 * and Ollama runs fully offline with no key at all. One provider covers them
 * all because they share the /chat/completions wire shape.
 */
/**
 * Short wait (in seconds) a 429 asks for, else null. Reads the retry-after
 * header and Groq's "Please try again in 2m59.56s" / "…in 231ms" message.
 */
function retryAfterSeconds(header: string | null, body: string): number | null {
  if (header && Number.isFinite(Number(header))) return Number(header);
  const ms = /try again in ([\d.]+)ms/i.exec(body);
  if (ms) return Number(ms[1]) / 1000;
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(body);
  if (m) return Number(m[1] ?? 0) * 60 + Number(m[2]);
  return null;
}

export class OpenAICompatibleProvider implements CopilotProvider {
  private readonly opts: Omit<
    Required<OpenAICompatibleProviderOptions>,
    'apiKey' | 'maxTokens' | 'fetchImpl'
  > & {
    apiKey?: string;
    maxTokens?: number;
    fetchImpl: typeof fetch;
  };

  constructor(options: OpenAICompatibleProviderOptions) {
    this.opts = {
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
      model: options.model,
      // bound: browsers throw "Illegal invocation" if fetch runs detached from window
      fetchImpl: options.fetchImpl ?? fetch.bind(globalThis),
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    };
  }

  private request(system: string, messages: CopilotMessage[]): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers['authorization'] = `Bearer ${this.opts.apiKey}`;
    return this.opts.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.opts.model,
        ...(this.opts.maxTokens !== undefined ? { max_tokens: this.opts.maxTokens } : {}),
        // OpenAI shape carries the system prompt as the first message
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
  }

  async complete(system: string, messages: CopilotMessage[]): Promise<string> {
    let res = await this.request(system, messages);
    if (res.status === 429) {
      // free-tier limits often clear in seconds — honor a short wait once
      const body = await res.text().catch(() => '');
      const wait = retryAfterSeconds(res.headers?.get?.('retry-after') ?? null, body);
      if (wait === null || wait > 30) throw new Error(`LLM API 429: ${body.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, (wait + 0.5) * 1000));
      res = await this.request(system, messages);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('LLM API returned no text content');
    return text;
  }
}
