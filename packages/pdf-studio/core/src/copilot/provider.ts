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
      fetchImpl: options.fetchImpl ?? fetch,
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
