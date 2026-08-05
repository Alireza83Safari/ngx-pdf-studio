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
  for (const file of ['server.js', 'service.js']) {
    copyFileSync(join(root, 'apps/render-service', file), join(work, file));
  }

  child = spawn(process.execPath, ['server.js'], {
    cwd: work,
    env: { ...process.env, PORT: String(PORT), MAX_BODY_BYTES: '2048', MAX_CONCURRENT: '2' },
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

  // MAX_BODY_BYTES is 2048 for this run, so this is comfortably over.
  const huge = await post({ template, data: { blob: 'x'.repeat(8192) } });
  check('an oversized body is 413', huge.status === 413, 'got ' + huge.status);

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
