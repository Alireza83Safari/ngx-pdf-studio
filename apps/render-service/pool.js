/**
 * A fixed pool of render threads, with a timeout that can actually stop one.
 *
 * `Promise.race` cannot bound a synchronous render — the timer is a task, and a
 * task cannot preempt code that never yields. Termination can: each job runs on
 * its own thread, and a job that overruns has its thread killed and replaced.
 *
 * The pool owns three limits that used to be nominal:
 *
 *  - **timeout** — enforced by `worker.terminate()`, not by a losing race;
 *  - **size** — real parallelism, so one slow render no longer stops the others
 *    (or `/healthz`, which is what a container's liveness probe asks);
 *  - **queue** — zero by default, keeping the original "shed load rather than
 *    queue" behaviour, except now it is true.
 *
 * `spawn` is injectable so the pool's decisions — which job goes where, what a
 * timeout does, what happens when a thread dies — are testable without loading
 * the engine or rendering anything.
 */
'use strict';

const { Worker } = require('node:worker_threads');
const { join } = require('node:path');

const WORKER_PATH = join(__dirname, 'render-worker.js');

/** An error carrying the HTTP status the caller should send. */
function statusError(status, message) {
  return Object.assign(new Error(message), { status: status });
}

/**
 * @param {{size?: number, timeoutMs?: number, maxQueue?: number, spawn?: () => import('node:worker_threads').Worker}} [options]
 */
function createPool(options) {
  const opts = options || {};
  const size = opts.size || 4;
  const timeoutMs = opts.timeoutMs || 15000;
  const maxQueue = opts.maxQueue == null ? 0 : opts.maxQueue;
  const spawn = opts.spawn || (() => new Worker(WORKER_PATH));

  const slots = [];
  const queue = [];
  let destroyed = false;

  /**
   * Hand a slot's job its outcome, exactly once.
   *
   * Every path out of a job — a reply, a timeout, a dead thread — comes through
   * here, and clearing `slot.job` first is what stops a thread that is killed on
   * timeout from also settling as a crash when its `exit` arrives.
   */
  function settle(slot, ok, value) {
    const job = slot.job;
    slot.job = null;
    if (!job) return false;
    clearTimeout(job.timer);
    if (ok) job.resolve(value);
    else job.reject(value);
    return true;
  }

  /** Replace a slot's thread: the old one is detached and killed, a fresh one takes over. */
  function replace(slot) {
    const old = slot.worker;
    slot.worker = null;
    if (old) {
      old.removeAllListeners();
      old.terminate();
    }
    if (!destroyed) attach(slot);
  }

  function attach(slot) {
    const worker = spawn();
    slot.worker = worker;
    worker.on('message', (msg) => {
      if (msg && msg.ok) settle(slot, true, msg);
      else
        settle(
          slot,
          false,
          Object.assign(
            statusError((msg && msg.status) || 500, (msg && msg.message) || 'render failed'),
            { details: msg && msg.details, stack: (msg && msg.stack) || undefined },
          ),
        );
      pump();
    });
    worker.on('error', (err) => {
      settle(slot, false, statusError(500, (err && err.message) || 'render thread failed'));
      replace(slot);
      pump();
    });
    worker.on('exit', (code) => {
      // Only meaningful for a thread still owned by this slot: `replace` detaches
      // before terminating, so a deliberate kill never lands here.
      if (slot.worker !== worker) return;
      settle(slot, false, statusError(500, 'render thread exited (' + code + ')'));
      replace(slot);
      pump();
    });
    // The HTTP server keeps the process alive; threads should not keep it alive
    // on their own, or a shut-down service would hang on idle workers.
    if (typeof worker.unref === 'function') worker.unref();
  }

  function onTimeout(slot) {
    settle(slot, false, statusError(504, 'render exceeded ' + timeoutMs + 'ms'));
    // The thread is still burning CPU inside a synchronous layout. Killing it is
    // the point: a replacement is cheaper than a stuck slot.
    replace(slot);
    pump();
  }

  function dispatch(slot, job) {
    slot.job = job;
    job.timer = setTimeout(() => onTimeout(slot), timeoutMs);
    slot.worker.postMessage(job.payload);
  }

  function pump() {
    while (queue.length) {
      const slot = slots.find((s) => !s.job && s.worker);
      if (!slot) return;
      dispatch(slot, queue.shift());
    }
  }

  for (let i = 0; i < size; i++) {
    const slot = { worker: null, job: null };
    slots.push(slot);
    attach(slot);
  }

  return {
    /** Render `payload` on a thread; rejects with `.status` set for every failure. */
    render(payload) {
      return new Promise((resolve, reject) => {
        if (destroyed) return reject(statusError(503, 'service is shutting down'));
        const job = { payload: payload, resolve: resolve, reject: reject, timer: null };
        const slot = slots.find((s) => !s.job && s.worker);
        if (slot) return dispatch(slot, job);
        if (queue.length < maxQueue) return queue.push(job);
        reject(statusError(503, 'too many concurrent renders'));
      });
    },

    /** What `/healthz` reports: enough to see saturation without a metrics stack. */
    stats() {
      return {
        size: size,
        inFlight: slots.filter((s) => s.job).length,
        queued: queue.length,
      };
    },

    async destroy() {
      destroyed = true;
      for (const job of queue.splice(0)) {
        clearTimeout(job.timer);
        job.reject(statusError(503, 'service is shutting down'));
      }
      await Promise.all(
        slots.map((slot) => {
          settle(slot, false, statusError(503, 'service is shutting down'));
          const worker = slot.worker;
          slot.worker = null;
          if (!worker) return undefined;
          worker.removeAllListeners();
          return worker.terminate();
        }),
      );
    },
  };
}

module.exports = { createPool, statusError, WORKER_PATH };
