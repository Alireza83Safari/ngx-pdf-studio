/**
 * The render pool's decisions, with fake threads.
 *
 * The bug this pool exists to fix was invisible to every test that mocked the
 * clock and not the thread: `Promise.race` *looks* like a timeout until the
 * work it races is synchronous, and then it silently never fires. So what is
 * asserted here is not "a timeout rejects" but "the thread is terminated and
 * replaced" — the part that actually bounds a synchronous render.
 *
 * `spawn` is injected, so none of this loads the engine or renders a PDF; the
 * real wiring is proved end-to-end by `tools/smoke-render-service.mjs`.
 */
const { EventEmitter } = require('node:events');
const { createPool } = require('./pool');

/** A thread that records what it was sent and whether it was killed. */
function fakeWorker() {
  const worker = new EventEmitter();
  worker.posted = [];
  worker.terminated = 0;
  worker.postMessage = (msg) => worker.posted.push(msg);
  worker.terminate = () => {
    worker.terminated++;
    return Promise.resolve(0);
  };
  worker.unref = () => undefined;
  return worker;
}

/** A pool over fake threads, plus the list of threads it has spawned so far. */
function harness(options) {
  const spawned = [];
  const pool = createPool({
    size: 1,
    timeoutMs: 1000,
    ...options,
    spawn: () => {
      const worker = fakeWorker();
      spawned.push(worker);
      return worker;
    },
  });
  return { pool, spawned };
}

const reply = (worker, msg) =>
  worker.emit('message', {
    ok: true,
    bytes: new Uint8Array([1]),
    pageCount: 1,
    diagnostics: [],
    ...msg,
  });

describe('dispatch', () => {
  it('sends the job to an idle thread and resolves with its reply', async () => {
    const { pool, spawned } = harness();
    const job = pool.render({ template: { a: 1 }, input: {} });
    expect(spawned[0].posted).toEqual([{ template: { a: 1 }, input: {} }]);
    reply(spawned[0], { pageCount: 7 });
    await expect(job).resolves.toMatchObject({ pageCount: 7 });
    await pool.destroy();
  });

  it('runs jobs on different threads at the same time', async () => {
    // The old single-threaded service could not do this at all: one render held
    // the loop, so `MAX_CONCURRENT` bounded nothing.
    const { pool, spawned } = harness({ size: 2 });
    const a = pool.render({ id: 'a' });
    const b = pool.render({ id: 'b' });
    expect(spawned[0].posted).toEqual([{ id: 'a' }]);
    expect(spawned[1].posted).toEqual([{ id: 'b' }]);
    expect(pool.stats()).toEqual({ size: 2, inFlight: 2, queued: 0 });
    reply(spawned[1]);
    reply(spawned[0]);
    await Promise.all([a, b]);
    await pool.destroy();
  });

  it('turns a worker failure reply into the status it carries', async () => {
    const { pool, spawned } = harness();
    const job = pool.render({});
    spawned[0].emit('message', {
      ok: false,
      status: 422,
      message: 'template failed validation',
      details: [{ path: 'bands', message: 'Required' }],
    });
    await expect(job).rejects.toMatchObject({
      status: 422,
      message: 'template failed validation',
      details: [{ path: 'bands', message: 'Required' }],
    });
    await pool.destroy();
  });
});

describe('load shedding', () => {
  it('sheds with 503 when every thread is busy and there is no queue', async () => {
    const { pool, spawned } = harness({ size: 1, maxQueue: 0 });
    const busy = pool.render({ id: 'a' });
    await expect(pool.render({ id: 'b' })).rejects.toMatchObject({ status: 503 });
    reply(spawned[0]);
    await busy;
    await pool.destroy();
  });

  it('queues up to maxQueue, then sheds', async () => {
    const { pool, spawned } = harness({ size: 1, maxQueue: 1 });
    const first = pool.render({ id: 'a' });
    const queued = pool.render({ id: 'b' });
    await expect(pool.render({ id: 'c' })).rejects.toMatchObject({ status: 503 });
    expect(pool.stats()).toEqual({ size: 1, inFlight: 1, queued: 1 });

    reply(spawned[0]);
    await first;
    // the queued job takes the freed thread rather than waiting for a new one
    expect(spawned).toHaveLength(1);
    expect(spawned[0].posted).toEqual([{ id: 'a' }, { id: 'b' }]);
    reply(spawned[0]);
    await queued;
    await pool.destroy();
  });
});

describe('timeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('terminates the thread rather than only rejecting the promise', async () => {
    // This is the whole point. A synchronous render ignores a rejected promise
    // and keeps burning the thread; only termination stops it.
    const { pool, spawned } = harness({ timeoutMs: 1000 });
    const job = pool.render({});
    jest.advanceTimersByTime(1000);
    await expect(job).rejects.toMatchObject({ status: 504 });
    expect(spawned[0].terminated).toBe(1);
    await pool.destroy();
  });

  it('replaces the killed thread, so the pool still works afterwards', async () => {
    const { pool, spawned } = harness({ timeoutMs: 1000 });
    await expect(
      (() => {
        const job = pool.render({ id: 'slow' });
        jest.advanceTimersByTime(1000);
        return job;
      })(),
    ).rejects.toMatchObject({ status: 504 });

    expect(spawned).toHaveLength(2);
    const next = pool.render({ id: 'after' });
    expect(spawned[1].posted).toEqual([{ id: 'after' }]);
    reply(spawned[1]);
    await expect(next).resolves.toBeDefined();
    await pool.destroy();
  });

  it('does not fire for a job that answered in time', async () => {
    const { pool, spawned } = harness({ timeoutMs: 1000 });
    const job = pool.render({});
    reply(spawned[0]);
    await expect(job).resolves.toBeDefined();
    jest.advanceTimersByTime(5000);
    // a stale timer must not kill the thread that is now serving someone else
    expect(spawned[0].terminated).toBe(0);
    await pool.destroy();
  });

  it('settles a timed-out job once, even though the dead thread also exits', async () => {
    const { pool, spawned } = harness({ timeoutMs: 1000 });
    const job = pool.render({});
    jest.advanceTimersByTime(1000);
    const outcome = await job.catch((err) => err);
    // the terminate() above would emit 'exit' on a real thread; the slot has
    // already let go of it, so the 504 stands rather than becoming a 500
    spawned[0].emit('exit', 1);
    expect(outcome.status).toBe(504);
    await pool.destroy();
  });
});

describe('a thread that dies', () => {
  it('fails its in-flight job with 500 and is replaced', async () => {
    const { pool, spawned } = harness();
    const job = pool.render({});
    spawned[0].emit('exit', 1);
    await expect(job).rejects.toMatchObject({ status: 500 });
    expect(spawned).toHaveLength(2);
    await pool.destroy();
  });

  it('is replaced after an error too, so one bad render is not fatal', async () => {
    const { pool, spawned } = harness();
    const job = pool.render({});
    spawned[0].emit('error', new Error('out of memory'));
    await expect(job).rejects.toMatchObject({ status: 500, message: 'out of memory' });

    const next = pool.render({ id: 'after' });
    expect(spawned[1].posted).toEqual([{ id: 'after' }]);
    reply(spawned[1]);
    await expect(next).resolves.toBeDefined();
    await pool.destroy();
  });
});

describe('destroy', () => {
  it('terminates every thread and refuses new work', async () => {
    const { pool, spawned } = harness({ size: 2 });
    await pool.destroy();
    expect(spawned.map((w) => w.terminated)).toEqual([1, 1]);
    await expect(pool.render({})).rejects.toMatchObject({ status: 503 });
  });

  it('fails in-flight and queued work rather than leaving callers hanging', async () => {
    const { pool } = harness({ size: 1, maxQueue: 1 });
    const inFlight = pool.render({ id: 'a' });
    const queued = pool.render({ id: 'b' });
    await pool.destroy();
    await expect(inFlight).rejects.toMatchObject({ status: 503 });
    await expect(queued).rejects.toMatchObject({ status: 503 });
  });

  it('does not respawn the threads it just killed', async () => {
    const { pool, spawned } = harness({ size: 2 });
    await pool.destroy();
    expect(spawned).toHaveLength(2);
  });
});
