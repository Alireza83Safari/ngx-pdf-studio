/**
 * Unit tests for the render service's request logic (designer-ux 5.3).
 *
 * These are the decisions a public endpoint gets wrong: what counts as a
 * request, which failure deserves which status, and whether a misconfiguration
 * is noticed. The end-to-end check (`tools/smoke-render-service.mjs`) proves
 * the wiring; this proves the rules.
 */
const { DEFAULTS, errorBody, parseRenderBody, readConfig, route, wantsJson } = require('./service');

describe('route', () => {
  it('matches the two endpoints', () => {
    expect(route('GET', '/healthz')).toEqual({ kind: 'health' });
    expect(route('POST', '/render')).toEqual({ kind: 'render' });
  });

  it('ignores the query string and a trailing slash', () => {
    expect(route('POST', '/render?debug=1').kind).toBe('render');
    expect(route('GET', '/healthz/').kind).toBe('health');
  });

  it('answers HEAD /healthz, which is what many probes actually send', () => {
    expect(route('HEAD', '/healthz').kind).toBe('health');
  });

  it('distinguishes a wrong method from a wrong path', () => {
    // 405 and 404 say different things to whoever is integrating: one means
    // "you are close", the other means "that endpoint does not exist"
    expect(route('GET', '/render')).toEqual({ kind: 'method', allow: 'POST' });
    expect(route('POST', '/healthz')).toEqual({ kind: 'method', allow: 'GET' });
    expect(route('POST', '/nope').kind).toBe('notFound');
    expect(route('GET', '/').kind).toBe('notFound');
  });
});

describe('parseRenderBody', () => {
  const template = { schemaVersion: '1.0.0', bands: [] };

  it('accepts a template with data', () => {
    const out = parseRenderBody(JSON.stringify({ template, data: { a: 1 } }));
    expect(out.ok).toBe(true);
    expect(out.template).toEqual(template);
    expect(out.input.data).toEqual({ a: 1 });
  });

  it('defaults missing data to an empty object rather than undefined', () => {
    expect(parseRenderBody(JSON.stringify({ template })).input.data).toEqual({});
  });

  it('passes a pinned clock through, and only when it is a real number', () => {
    expect(parseRenderBody(JSON.stringify({ template, now: 1700000000000 })).input.now).toBe(
      1700000000000,
    );
    // a string date is a caller mistake that must not become a NaN clock
    expect(
      parseRenderBody(JSON.stringify({ template, now: '2024-01-01' })).input.now,
    ).toBeUndefined();
  });

  it('rejects a body that is not JSON', () => {
    const out = parseRenderBody('{oops');
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
    expect(out.message).toMatch(/not valid JSON/);
  });

  it('rejects shapes that are JSON but are not a request', () => {
    for (const raw of ['[]', '"a string"', 'null', '42']) {
      expect(parseRenderBody(raw).status).toBe(400);
    }
  });

  it('requires a template object, not a string, an array, or nothing', () => {
    expect(parseRenderBody(JSON.stringify({ data: {} })).status).toBe(400);
    expect(parseRenderBody(JSON.stringify({ template: 'invoice' })).status).toBe(400);
    expect(parseRenderBody(JSON.stringify({ template: [] })).status).toBe(400);
  });

  it('rejects non-object data instead of handing it to the engine', () => {
    expect(parseRenderBody(JSON.stringify({ template, data: 'rows' })).status).toBe(400);
    expect(parseRenderBody(JSON.stringify({ template, data: null })).status).toBe(400);
  });

  it('does not judge whether the template is valid — that is the engine’s job', () => {
    // a second schema here would be a second thing to drift out of step
    expect(parseRenderBody(JSON.stringify({ template: { nonsense: true } })).ok).toBe(true);
  });
});

describe('readConfig', () => {
  it('falls back to the defaults when nothing is set', () => {
    const { config, errors } = readConfig({});
    expect(errors).toEqual([]);
    expect(config).toEqual(DEFAULTS);
  });

  it('reads the knobs from the environment', () => {
    const { config } = readConfig({ PORT: '8080', MAX_BODY_BYTES: '2048' });
    expect(config.port).toBe(8080);
    expect(config.maxBodyBytes).toBe(2048);
  });

  it('reports a nonsense value rather than quietly using the default', () => {
    // a service told MAX_BODY_BYTES=0 must not silently accept 1 MiB uploads
    const { errors } = readConfig({ MAX_BODY_BYTES: '0', RENDER_TIMEOUT_MS: 'soon' });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/MAX_BODY_BYTES/);
    expect(errors[1]).toMatch(/RENDER_TIMEOUT_MS/);
  });

  it('treats an unset variable and an empty one the same', () => {
    expect(readConfig({ PORT: '' }).errors).toEqual([]);
    expect(readConfig({ PORT: '' }).config.port).toBe(DEFAULTS.port);
  });

  it('rejects a negative timeout, which would fire before the render began', () => {
    expect(readConfig({ RENDER_TIMEOUT_MS: '-1' }).errors).toHaveLength(1);
  });
});

describe('wantsJson', () => {
  it('is off by default, so `curl -o out.pdf` gets a PDF', () => {
    expect(wantsJson(undefined)).toBe(false);
    expect(wantsJson('*/*')).toBe(false);
    expect(wantsJson('application/pdf')).toBe(false);
  });

  it('is on when the caller asks for JSON, however they spell it', () => {
    expect(wantsJson('application/json')).toBe(true);
    expect(wantsJson('APPLICATION/JSON')).toBe(true);
    expect(wantsJson('text/html, application/json;q=0.9')).toBe(true);
  });
});

describe('errorBody', () => {
  it('is one shape for every failure', () => {
    expect(JSON.parse(errorBody(404, 'not found'))).toEqual({
      error: { status: 404, message: 'not found' },
    });
  });

  it('carries validation issues when there are some', () => {
    const issues = [{ path: 'bands', message: 'Required' }];
    expect(JSON.parse(errorBody(422, 'bad', issues)).error.details).toEqual(issues);
  });
});
