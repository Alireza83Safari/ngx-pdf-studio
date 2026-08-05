/**
 * `POST /render {template, data}` → PDF (designer-ux 5.3).
 *
 * A one-container way to use the engine from any stack: design in the browser,
 * generate on a server that need not be Node. Built on `node:http` with no
 * framework, because the whole surface is two routes and a body limit — adding
 * a dependency tree to an image whose job is rendering PDFs would cost more
 * than it saves.
 *
 * Fonts load once at startup: without Vazirmatn embedded, Persian output — the
 * thing this library exists to get right — is silently broken.
 */
'use strict';

const { createServer } = require('node:http');
const { loadBundledVazirmatn, renderToPdf } = require('@ngx-pdf-studio/core/node');
const { importTemplate } = require('@ngx-pdf-studio/core');
const { errorBody, parseRenderBody, readConfig, route, wantsJson } = require('./service');

const { config, errors } = readConfig(process.env);
if (errors.length) {
  console.error('bad configuration:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const fonts = loadBundledVazirmatn();
let inFlight = 0;

function send(res, status, type, body, headers) {
  res.writeHead(
    status,
    Object.assign(
      { 'content-type': type, 'content-length': Buffer.byteLength(body) },
      headers || {},
    ),
  );
  res.end(body);
}
const sendError = (res, status, message, details) =>
  send(res, status, 'application/json; charset=utf-8', errorBody(status, message, details));

/**
 * Read the body, refusing an oversized one *while* it arrives.
 *
 * The limit is enforced per chunk rather than on the finished buffer: checking
 * afterwards would mean already having accepted a gigabyte into memory, which
 * is the thing the limit exists to prevent.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let overLimit = false;
    req.on('data', (chunk) => {
      if (overLimit) return; // still arriving; buffer nothing more
      size += chunk.length;
      if (size > limit) {
        overLimit = true;
        chunks = []; // release what was read rather than hold it to reply
        reject(
          Object.assign(new Error('request body exceeds ' + limit + ' bytes'), { status: 413 }),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    // A client that hangs up mid-upload is not an error worth logging as one.
    req.on('error', reject);
    req.on('aborted', () => reject(Object.assign(new Error('client aborted'), { status: 400 })));
  });
}

/** Answer rather than hang: a template can paginate or loop without end. */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error('render exceeded ' + ms + 'ms'), { status: 504 })),
        ms,
      );
    }),
  ]);
}

async function handleRender(req, res) {
  // A queue that only grows is a slower way to fall over. Shed load and say so,
  // so a caller can back off instead of guessing.
  if (inFlight >= config.maxConcurrent) {
    return send(
      res,
      503,
      'application/json; charset=utf-8',
      errorBody(503, 'too many concurrent renders'),
      { 'retry-after': '1' },
    );
  }
  inFlight++;
  try {
    const raw = await readBody(req, config.maxBodyBytes);
    const parsed = parseRenderBody(raw);
    if (!parsed.ok) return sendError(res, parsed.status, parsed.message);

    // Validate through the engine's own schema. The template is untrusted
    // input, and `importTemplate` is the single definition of what is valid —
    // so the service never invents a second one to drift away from it.
    const check = importTemplate(JSON.stringify(parsed.template));
    if (!check.success) return sendError(res, 422, 'template failed validation', check.issues);

    const result = await withTimeout(
      renderToPdf(check.value, parsed.input, { pdf: { fonts: fonts } }),
      config.renderTimeoutMs,
    );
    const diagnostics = result.diagnostics || [];
    if (wantsJson(req.headers.accept)) {
      return send(
        res,
        200,
        'application/json; charset=utf-8',
        JSON.stringify({
          pdf: Buffer.from(result.bytes).toString('base64'),
          pageCount: result.pageCount,
          diagnostics: diagnostics,
        }),
      );
    }
    // Diagnostics are non-fatal by policy, so the PDF is still the answer — but
    // the count rides along, or a caller taking bytes only would never learn
    // that a font was missing or an expression failed.
    return send(res, 200, 'application/pdf', Buffer.from(result.bytes), {
      'x-page-count': String(result.pageCount),
      'x-diagnostic-count': String(diagnostics.length),
      'content-disposition': 'inline; filename="document.pdf"',
    });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (status === 500) console.error('render failed:', err && err.stack ? err.stack : err);
    if (res.writableEnded || res.destroyed) return undefined;
    sendError(res, status, (err && err.message) || 'render failed');
    // An oversized body is answered first and hung up second. Destroying the
    // socket instead — the tempting shortcut — leaves the caller with a dropped
    // connection and no idea why. The hang-up stops a client that keeps
    // uploading after being told to stop; the e2e proves the 413, not the
    // disconnect, which would need a client that ignores the response.
    if (status === 413) res.on('finish', () => req.destroy());
    return undefined;
  } finally {
    inFlight--;
  }
}

const server = createServer((req, res) => {
  const r = route(req.method, req.url);
  if (r.kind === 'health') {
    return send(
      res,
      200,
      'application/json; charset=utf-8',
      JSON.stringify({ ok: true, inFlight: inFlight }),
    );
  }
  if (r.kind === 'render') return handleRender(req, res);
  if (r.kind === 'method') {
    return send(res, 405, 'application/json; charset=utf-8', errorBody(405, 'method not allowed'), {
      allow: r.allow,
    });
  }
  return sendError(res, 404, 'not found');
});

server.listen(config.port, () => {
  console.log(
    'pdf-studio render service on :' +
      config.port +
      ' (max body ' +
      config.maxBodyBytes +
      'B, timeout ' +
      config.renderTimeoutMs +
      'ms, concurrency ' +
      config.maxConcurrent +
      ')',
  );
});

// Container stop is a signal, not a kill: finish what is in flight first.
['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => server.close(() => process.exit(0)));
});

module.exports = { server };
