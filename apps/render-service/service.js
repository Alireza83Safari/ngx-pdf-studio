/**
 * Request logic for the render service, with no `http` and no engine.
 *
 * Everything here decides *what should happen* to a request; `server.js` does
 * the socket work and the actual rendering. Split that way because the
 * interesting failures of a public endpoint are decisions — is this body too
 * big, is this JSON the right shape, what status does this deserve — and those
 * should be assertable without opening a port or rendering a PDF.
 *
 * CommonJS, like the designer's `designer-util.js`: the test project runs it
 * with no transform, so what the container executes is what the tests assert.
 */
'use strict';

/** Defaults chosen to be safe for an unauthenticated endpoint on the internet. */
const DEFAULTS = {
  maxBodyBytes: 1024 * 1024, // 1 MiB: templates are JSON, not media
  renderTimeoutMs: 15000,
  maxConcurrent: 4, // render threads; see pool.js for why this is a thread count
  maxQueue: 0, // shed load rather than queue — a queue that only grows is a slower fall
  port: 3000,
};

/**
 * Read the knobs from the environment, falling back to the defaults.
 *
 * A value that is present but not a positive number is a misconfiguration, not
 * a reason to silently run with a default — a service told `MAX_BODY_BYTES=0`
 * should refuse to start rather than quietly accept 1 MiB uploads.
 */
function readConfig(env) {
  const source = env || {};
  const errors = [];
  const num = (name, fallback, floor) => {
    const raw = source[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    const min = floor === undefined ? 1 : floor;
    if (!Number.isFinite(n) || n < min) {
      const bound = min === 0 ? 'a non-negative number' : 'a positive number';
      errors.push(name + ' must be ' + bound + ', got ' + JSON.stringify(raw));
      return fallback;
    }
    return n;
  };
  return {
    config: {
      maxBodyBytes: num('MAX_BODY_BYTES', DEFAULTS.maxBodyBytes),
      renderTimeoutMs: num('RENDER_TIMEOUT_MS', DEFAULTS.renderTimeoutMs),
      maxConcurrent: num('MAX_CONCURRENT', DEFAULTS.maxConcurrent),
      // Zero is the default and a meaningful value here, unlike every other
      // knob: it means "do not queue at all".
      maxQueue: num('MAX_QUEUE', DEFAULTS.maxQueue, 0),
      port: num('PORT', DEFAULTS.port),
    },
    errors,
  };
}

/**
 * Which endpoint a request is for.
 *
 * Matched on the path alone, so `/render?debug=1` is still `/render`, and a
 * known path with the wrong method gets 405 rather than 404 — the two mean
 * different things to whoever is integrating.
 */
function route(method, url) {
  const path = String(url || '/').split('?')[0];
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (clean === '/healthz') {
    return method === 'GET' || method === 'HEAD'
      ? { kind: 'health' }
      : { kind: 'method', allow: 'GET' };
  }
  if (clean === '/render') {
    return method === 'POST' ? { kind: 'render' } : { kind: 'method', allow: 'POST' };
  }
  return { kind: 'notFound' };
}

/**
 * Parse a render request body into `{ template, input }`.
 *
 * This checks the envelope only — that it is JSON, an object, and carries a
 * template. Whether the template is *valid* is the engine's judgement, and
 * duplicating that here would be a second schema to drift.
 */
function parseRenderBody(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    return { ok: false, status: 400, message: 'body is not valid JSON: ' + err.message };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, message: 'body must be a JSON object' };
  }
  if (!body.template || typeof body.template !== 'object' || Array.isArray(body.template)) {
    return { ok: false, status: 400, message: 'body.template is required and must be an object' };
  }
  if (body.data !== undefined && (typeof body.data !== 'object' || body.data === null)) {
    return { ok: false, status: 400, message: 'body.data must be an object when present' };
  }
  const input = { data: body.data || {} };
  if (body.parameters) input.parameters = body.parameters;
  // A caller who wants reproducible bytes pins the clock. Otherwise the
  // engine's documented default applies and date fields render empty, which is
  // what keeps output byte-deterministic.
  if (typeof body.now === 'number' && Number.isFinite(body.now)) input.now = body.now;
  return { ok: true, template: body.template, input: input };
}

/**
 * Does the caller want the JSON envelope instead of raw PDF bytes?
 *
 * Raw bytes are the default because `curl -o out.pdf` is the obvious use. JSON
 * exists so diagnostics stay reachable: the engine reports non-fatal problems
 * (a missing font, an expression that failed) alongside a PDF that still
 * rendered, and a bytes-only API would drop them on the floor.
 */
function wantsJson(accept) {
  return /application\/json/i.test(String(accept == null ? '' : accept));
}

/** The body of an error response — one shape for every failure. */
function errorBody(status, message, details) {
  const error = { status: status, message: message };
  if (details) error.details = details;
  return JSON.stringify({ error: error });
}

module.exports = { DEFAULTS, readConfig, route, parseRenderBody, wantsJson, errorBody };
