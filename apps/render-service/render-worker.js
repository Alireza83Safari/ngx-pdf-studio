/**
 * The thread that actually renders (designer-ux 5.3).
 *
 * Everything expensive runs here — validation included — because `paginate`
 * and both painters are **synchronous**. On the main thread a single request
 * holds the event loop for as long as its layout takes, and while it does, the
 * render timeout cannot fire, `/healthz` cannot answer, and the concurrency cap
 * cannot shed anything. Measured before this existed: a 248 KiB body (the limit
 * is 1 MiB) blocked for 6.1 s and a 50 ms timer never ran.
 *
 * A thread can be stopped mid-computation with `worker.terminate()`, which is
 * the only thing that actually bounds a synchronous render. That is the whole
 * reason this file is separate from `server.js`.
 *
 * Validation lives here too, not in the server: `importTemplate` walks a zod
 * schema over attacker-shaped JSON, so it is also unbounded work and belongs
 * on the side of the boundary that can be killed.
 */
'use strict';

const { parentPort } = require('node:worker_threads');
const { loadBundledVazirmatn, renderToPdf } = require('@ngx-pdf-studio/core/node');
const { importTemplate } = require('@ngx-pdf-studio/core');

// Once per thread, at startup: without Vazirmatn embedded, Persian output —
// the thing this library exists to get right — is silently broken.
const fonts = loadBundledVazirmatn();

parentPort.on('message', async (job) => {
  try {
    const check = importTemplate(JSON.stringify(job.template));
    if (!check.success) {
      parentPort.postMessage({
        ok: false,
        status: 422,
        message: 'template failed validation',
        details: check.issues,
      });
      return;
    }
    const result = await renderToPdf(check.value, job.input, { pdf: { fonts: fonts } });
    parentPort.postMessage({
      ok: true,
      bytes: result.bytes,
      pageCount: result.pageCount,
      diagnostics: result.diagnostics || [],
    });
  } catch (err) {
    // A stack rides along so the server can log a real 500 rather than a
    // one-line message with no way back to the cause.
    parentPort.postMessage({
      ok: false,
      status: 500,
      message: (err && err.message) || 'render failed',
      stack: err && err.stack ? err.stack : undefined,
    });
  }
});
