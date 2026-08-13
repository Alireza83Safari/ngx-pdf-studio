/**
 * `POST /render {template, data}` → PDF (designer-ux 5.3).
 *
 * A one-container way to use the engine from any stack: design in the browser,
 * generate on a server that need not be Node. Built on `node:http` with no
 * framework, because the whole surface is two routes and a body limit — adding
 * a dependency tree to an image whose job is rendering PDFs would cost more
 * than it saves.
 *
 * Rendering itself happens on a thread pool (`pool.js`), never here: layout and
 * both painters are synchronous, so a render on this thread would hold the
 * event loop and take the timeout, the concurrency cap and `/healthz` down with
 * it. This file does socket work and nothing else that can take long.
 */
'use strict';

const { createServer } = require('node:http');
const { createPool } = require('./pool');
const { errorBody, parseRenderBody, readConfig, route, wantsJson } = require('./service');

const { config, errors } = readConfig(process.env);
if (errors.length) {
  console.error('bad configuration:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const pool = createPool({
  size: config.maxConcurrent,
  timeoutMs: config.renderTimeoutMs,
  maxQueue: config.maxQueue,
});

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

async function handleRender(req, res) {
  try {
    const raw = await readBody(req, config.maxBodyBytes);
    const parsed = parseRenderBody(raw);
    if (!parsed.ok) return sendError(res, parsed.status, parsed.message);

    // Validation happens on the worker, not here: `importTemplate` walks a zod
    // schema over untrusted JSON, which is unbounded work like the render it
    // guards, and belongs on the side of the boundary that can be killed.
    const result = await pool.render({ template: parsed.template, input: parsed.input });
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
    // 422 carries the engine's own validation issues; every other failure is a
    // single message, so `details` is only ever set where it means something.
    if (status === 422) return sendError(res, status, err.message, err.details);
    sendError(res, status, (err && err.message) || 'render failed');
    // An oversized body is answered first and hung up second. Destroying the
    // socket instead — the tempting shortcut — leaves the caller with a dropped
    // connection and no idea why. The hang-up stops a client that keeps
    // uploading after being told to stop; the e2e proves the 413, not the
    // disconnect, which would need a client that ignores the response.
    if (status === 413) res.on('finish', () => req.destroy());
    return undefined;
  }
}

const server = createServer((req, res) => {
  const r = route(req.method, req.url);
  if (r.kind === 'health') {
    // Answerable while every thread is busy, which is the whole point of the
    // pool: a liveness probe that only succeeds when the service is idle is a
    // restart loop waiting for traffic.
    const stats = pool.stats();
    return send(
      res,
      200,
      'application/json; charset=utf-8',
      JSON.stringify({
        ok: true,
        inFlight: stats.inFlight,
        queued: stats.queued,
        size: stats.size,
      }),
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
      'ms, ' +
      config.maxConcurrent +
      ' render threads, queue ' +
      config.maxQueue +
      ')',
  );
});

// Container stop is a signal, not a kill: stop accepting, finish what is in
// flight, then take the threads down — they are unref'd, so nothing else will.
['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => {
    server.close(() => {
      pool.destroy().then(
        () => process.exit(0),
        () => process.exit(0),
      );
    });
  });
});

module.exports = { server, pool };
