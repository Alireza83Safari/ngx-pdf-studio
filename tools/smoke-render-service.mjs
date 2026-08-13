/**
 * End-to-end check for the render service (designer-ux 5.3).
 *
 * Does what the Dockerfile does — pack the built core dist, install that
 * tarball into a pristine project, drop the service beside it — then starts the
 * server and talks HTTP to it. Installing the tarball rather than pointing at
 * the workspace is the point: it proves the service runs against the artifact
 * consumers actually get, so a packaging mistake fails here rather than after a
 * release.
 *
 * Run `npm run build:core` first.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'packages/pdf-studio/core/dist');
if (!existsSync(join(dist, 'index.js'))) {
  console.error('core dist missing — run `npm run build:core` first');
  process.exit(1);
}

// Same Windows handling as smoke-tarball.mjs: since the CVE-2024-27980 fix Node
// refuses to spawn a `.cmd` without a shell, which then needs quoted paths.
const isWindows = process.platform === 'win32';
const NPM = isWindows ? 'npm.cmd' : 'npm';
const npmArgs = (args) => (isWindows ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args);
const npmOpts = isWindows ? { shell: true } : {};
const npm = (args, opts = {}) => execFileSync(NPM, npmArgs(args), { ...npmOpts, ...opts });

const PORT = 3579;
const BASE = 'http://127.0.0.1:' + PORT;
const work = mkdtempSync(join(tmpdir(), 'pdf-studio-render-'));
let child = null;
let failures = 0;

const check = (label, ok, detail) => {
  if (ok) {
    console.log('  ✓ ' + label);
    return;
  }
  failures++;
  console.error('  ✗ ' + label + (detail === undefined ? '' : ' — ' + detail));
};

// The same request CI posts at the built container, so the two cannot drift
// into testing different documents.
const { template } = JSON.parse(
  readFileSync(join(root, 'tools/fixtures/render-request.json'), 'utf8'),
);

const post = (body, headers = {}) =>
  fetch(BASE + '/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

try {
  // stdout carries the tarball name; npm's notices go to stderr and are noise here
  const packOut = npm(['pack', dist, '--pack-destination', work], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const tarball = join(work, packOut.trim().split('\n').pop());
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'render-service-smoke', private: true, version: '0.0.0' }, null, 2),
  );
  npm(['install', '--omit=dev', '--no-audit', '--no-fund', tarball], {
    cwd: work,
    stdio: 'ignore',
  });
  for (const file of ['server.js', 'service.js', 'pool.js', 'render-worker.js']) {
    copyFileSync(join(root, 'apps/render-service', file), join(work, file));
  }

  child = spawn(process.execPath, ['server.js'], {
    cwd: work,
    env: {
      ...process.env,
      PORT: String(PORT),
      // Big enough to carry the deliberately expensive template below, which is
      // what proves the timeout is real; the 413 check sends more than this.
      MAX_BODY_BYTES: '262144',
      MAX_CONCURRENT: '2',
      RENDER_TIMEOUT_MS: '4000',
      // A low row ceiling, so one request can prove the engine's limits are
      // wired through and answered as 422.
      MAX_ROWS: '3000',
      // …and effectively no step ceiling, so the *other* request gets far enough
      // to prove the timeout. The limits stop expensive templates cheaply; the
      // timeout is the last line of defence behind them, and it only gets
      // exercised if nothing shorter fires first. Both matter, so both run.
      MAX_EXPRESSION_STEPS: '10000000000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write('[service] ' + d));

  // Wait for the port rather than sleeping a guessed interval.
  const deadline = Date.now() + 30000;
  let up = false;
  while (Date.now() < deadline && !up) {
    try {
      const res = await fetch(BASE + '/healthz');
      up = res.ok;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!up) throw new Error('service did not come up within 30s');

  console.log('render service e2e:');

  const health = await fetch(BASE + '/healthz');
  const healthBody = await health.json();
  check('GET /healthz is 200 and reports ok', health.status === 200 && healthBody.ok === true);

  const pdf = await post({ template, data: {} });
  const bytes = Buffer.from(await pdf.arrayBuffer());
  // report *why* on failure: a bare "got 422" sends you hunting the service
  // when the fixture is what is wrong, which is exactly what happened here
  check(
    'POST /render is 200',
    pdf.status === 200,
    pdf.status === 200 ? '' : 'got ' + pdf.status + ': ' + bytes.toString('utf8').slice(0, 400),
  );
  check(
    'the response is a PDF',
    pdf.headers.get('content-type') === 'application/pdf' &&
      bytes.subarray(0, 5).toString('latin1') === '%PDF-',
    bytes.subarray(0, 16).toString('latin1'),
  );
  check('it reports the page count', pdf.headers.get('x-page-count') === '1');
  // The service must embed the bundled font, or Persian output — the one thing
  // this library exists to get right — is silently broken.
  //
  // Not asserted by searching the bytes for "Vazirmatn": pdf-lib writes object
  // streams, so the font name is compressed and never appears literally. Not by
  // file size either, since a correct subset of a few glyphs is only a few KB.
  // Instead, ask the service for the same document in a font it cannot have:
  // the engine then reports a diagnostic and embeds nothing, so the difference
  // between the two responses is exactly the embedding.
  const noFont = JSON.parse(JSON.stringify(template));
  noFont.bands[0].elements[0].typography.fontFamily = 'NoSuchFontExists';
  const unfonted = await post({ template: noFont, data: {} });
  const unfontedBytes = Buffer.from(await unfonted.arrayBuffer());
  check(
    'a font the service does not have is reported, not silently substituted',
    Number(unfonted.headers.get('x-diagnostic-count')) > 0,
    'diagnostics: ' + unfonted.headers.get('x-diagnostic-count'),
  );
  check(
    'the bundled Persian font is embedded when it is asked for',
    pdf.headers.get('x-diagnostic-count') === '0' && bytes.length > unfontedBytes.length,
    'diagnostics ' +
      pdf.headers.get('x-diagnostic-count') +
      ', ' +
      bytes.length +
      'B vs ' +
      unfontedBytes.length +
      'B unembedded',
  );

  // Byte-determinism is the engine's central promise; the service must not
  // introduce anything per-request that breaks it.
  const again = Buffer.from(await (await post({ template, data: {} })).arrayBuffer());
  check('two identical requests return identical bytes', again.equals(bytes));

  const asJson = await post({ template, data: {} }, { accept: 'application/json' });
  const envelope = await asJson.json();
  check(
    'Accept: application/json returns the envelope with diagnostics',
    asJson.status === 200 &&
      typeof envelope.pdf === 'string' &&
      envelope.pageCount === 1 &&
      Array.isArray(envelope.diagnostics),
  );
  check(
    'the base64 in the envelope is the same PDF',
    typeof envelope.pdf === 'string' && Buffer.from(envelope.pdf, 'base64').equals(bytes),
  );

  const badJson = await post('{not json');
  check('malformed JSON is 400', badJson.status === 400, 'got ' + badJson.status);

  const noTemplate = await post({ data: {} });
  check('a missing template is 400', noTemplate.status === 400, 'got ' + noTemplate.status);

  const invalid = await post({ template: { schemaVersion: '1.0.0' } });
  const invalidBody = await invalid.json();
  check('an invalid template is 422', invalid.status === 422, 'got ' + invalid.status);
  check('and says what was wrong with it', Array.isArray(invalidBody.error.details));

  // MAX_BODY_BYTES is 256 KiB for this run, so this is comfortably over.
  const huge = await post({ template, data: { blob: 'x'.repeat(400_000) } });
  check('an oversized body is 413', huge.status === 413, 'got ' + huge.status);

  // The regression that matters most (§ render-service): layout and both
  // painters are synchronous, so before the thread pool a single request held
  // the event loop — the render timeout could not fire, `/healthz` could not
  // answer, and the container's own liveness probe killed it. A promise race
  // cannot preempt synchronous code; only terminating the thread can.
  //
  // `sum(slice($root.items, 0, $index + 1), …)` is the documented running-total
  // idiom and is O(n²), so a body well under the limit buys minutes of work.
  const items = (n) => Array.from({ length: n }, (_, i) => ({ n: i, p: i * 13 }));
  const rows = items(2500);
  const running = { source: "sum(slice($root.items, 0, $index + 1), 'p')" };
  const heavy = {
    schemaVersion: '1.0.0',
    metadata: { name: 'runaway' },
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 36, right: 36, bottom: 36, left: 36 },
      direction: 'rtl',
      locale: { language: 'fa', digits: 'persian', calendar: 'jalali' },
      unit: 'pt',
    },
    styles: [],
    datasets: [{ name: 'items', source: { kind: 'path', path: 'items' } }],
    parameters: [],
    bands: [
      {
        id: 'd',
        type: 'detail',
        dataset: 'items',
        height: { mode: 'fixed', value: 20 },
        elements: [0, 1, 2].map((i) => ({
          id: 'f' + i,
          type: 'dataField',
          bounds: { x: i * 160, y: 0, width: 150, height: 16 },
          zIndex: 1,
          value: running,
        })),
      },
    ],
    resources: { fonts: [], images: [] },
  };

  // A template over the engine's work limits is refused like any other template
  // the engine will not accept — quickly, and saying which ceiling it hit —
  // rather than occupying a thread for the full timeout.
  const tooManyRows = await post({ template: heavy, data: { items: items(5000) } });
  const tooManyRowsBody = await tooManyRows.json();
  check(
    'a template over the row limit is 422, not a spent thread',
    tooManyRows.status === 422,
    'got ' + tooManyRows.status,
  );
  check(
    'and it names the ceiling it hit',
    tooManyRowsBody.error?.details?.[0]?.limit === 'rows',
    JSON.stringify(tooManyRowsBody.error?.details),
  );

  const runawayStarted = Date.now();
  const runaway = post({ template: heavy, data: { items: rows } });
  // Give the render a moment to be genuinely mid-layout, then ask the question
  // the old service could not answer while it was busy.
  await new Promise((r) => setTimeout(r, 750));
  const probeStarted = Date.now();
  const probe = await fetch(BASE + '/healthz');
  const probeMs = Date.now() - probeStarted;
  const probeBody = await probe.json();
  check(
    '/healthz answers while a runaway render is in flight',
    probe.status === 200 && probeMs < 1000,
    'took ' + probeMs + 'ms, status ' + probe.status,
  );
  check(
    'and it reports the render as in flight rather than pretending to be idle',
    probeBody.inFlight === 1,
    'inFlight was ' + probeBody.inFlight,
  );

  const timedOut = await runaway;
  const runawayMs = Date.now() - runawayStarted;
  check(
    'a render that overruns RENDER_TIMEOUT_MS is 504',
    timedOut.status === 504,
    'got ' + timedOut.status + ' after ' + runawayMs + 'ms',
  );
  check(
    'and it is answered near the deadline, not when the layout happens to finish',
    runawayMs < 12_000,
    'took ' + runawayMs + 'ms for a 4000ms timeout',
  );

  // The killed thread must be replaced, or the pool leaks a slot per timeout
  // and the service dies by attrition.
  const afterTimeout = await post({ template, data: {} });
  check(
    'the service still renders after killing a runaway thread',
    afterTimeout.status === 200,
    'got ' + afterTimeout.status,
  );

  const wrongMethod = await fetch(BASE + '/render');
  check('GET /render is 405, not 404', wrongMethod.status === 405, 'got ' + wrongMethod.status);
  check('and it advertises the right method', wrongMethod.headers.get('allow') === 'POST');

  const missing = await fetch(BASE + '/nope');
  check('an unknown path is 404', missing.status === 404, 'got ' + missing.status);

  // The service still answers after every one of those failures.
  const afterAll = await fetch(BASE + '/healthz');
  check('the service is still healthy after all of that', afterAll.status === 200);
  check(
    'and is not leaking in-flight slots',
    (await afterAll.json()).inFlight === 0,
    'inFlight was not 0',
  );
} finally {
  // Wait for the child to actually exit before deleting its cwd: `kill()` only
  // signals, and on Windows the directory stays locked until the process is
  // gone, which turns a passing run into an EBUSY crash.
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch (err) {
    // a leftover temp directory is not a test result
    console.warn('could not clean up ' + work + ': ' + err.message);
  }
}

if (failures) {
  console.error('\nrender service e2e FAILED (' + failures + ')');
  process.exit(1);
}
console.log('\nrender service e2e OK');
