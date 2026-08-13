# PDF Studio render service

`POST /render {template, data}` → PDF. One container, any stack: design in the
browser, generate on a server that need not be Node.

Built on `node:http` with no framework — the surface is two routes and a body
limit, so a dependency tree would cost more than it saves.

Renders run on a **pool of worker threads**, never on the request thread. Layout
and both painters are synchronous, so a render on the main thread holds the
event loop for as long as it takes — and while it does, the timeout cannot fire,
`/healthz` cannot answer, and the concurrency cap cannot shed anything. Only
`worker.terminate()` bounds a synchronous render, and it is a thread-level
operation. See [`pool.js`](pool.js).

## Run it

```bash
npm run build:core
docker build -f apps/render-service/Dockerfile -t pdfstudio/render .
docker run -p 3000:3000 pdfstudio/render
```

Or, in the repo, without Docker:

```bash
npm run build:core && npm run render:serve
```

## Endpoints

### `POST /render`

```jsonc
{
  "template": {
    /* a PdfTemplate — validated by the engine's own schema */
  },
  "data": {}, // optional, defaults to {}
  "parameters": {}, // optional
  "now": 1700000000000, // optional epoch ms; pin it for reproducible bytes
}
```

Returns `application/pdf` with:

| header               | meaning                                     |
| -------------------- | ------------------------------------------- |
| `X-Page-Count`       | pages in the document                       |
| `X-Diagnostic-Count` | non-fatal problems the engine reported (§9) |

```bash
curl -sS -X POST localhost:3000/render \
  -H 'content-type: application/json' \
  -d '{"template":{...},"data":{}}' -o out.pdf
```

Send `Accept: application/json` to get the diagnostics themselves rather than
just their count — a bytes-only API would drop them on the floor:

```jsonc
{ "pdf": "<base64>", "pageCount": 1, "diagnostics": [] }
```

Diagnostics are **non-fatal**: a PDF that rendered is still returned. A missing
font or a failed expression shows up here, not as an error.

### `GET /healthz`

`{ "ok": true, "inFlight": 0, "queued": 0, "size": 4 }`. Answers `HEAD` too,
which is what most probes actually send.

It answers **while renders are in flight**, because rendering happens on other
threads. A liveness probe that only succeeds when the service is idle is a
restart loop waiting for traffic.

## Failures

| status | when                                                           |
| ------ | -------------------------------------------------------------- |
| `400`  | body is not JSON, or not `{template, data?}`                   |
| `404`  | unknown path                                                   |
| `405`  | known path, wrong method (with `Allow`)                        |
| `413`  | body over `MAX_BODY_BYTES`, refused while it arrives           |
| `422`  | template failed the engine's schema — `error.details` says why |
| `503`  | `MAX_CONCURRENT` renders already running (with `Retry-After`)  |
| `504`  | render exceeded `RENDER_TIMEOUT_MS`                            |

## Configuration

| variable            | default   | notes                                                               |
| ------------------- | --------- | ------------------------------------------------------------------- |
| `PORT`              | `3000`    |                                                                     |
| `MAX_BODY_BYTES`    | `1048576` | 1 MiB — templates are JSON, not media                               |
| `RENDER_TIMEOUT_MS` | `15000`   | enforced by killing the render thread, not by a losing promise race |
| `MAX_CONCURRENT`    | `4`       | render **threads** — real parallelism, one per concurrent render    |
| `MAX_QUEUE`         | `0`       | jobs to hold when every thread is busy; `0` sheds with `503`        |

A variable that is set but not a positive number stops the service at startup
rather than silently falling back — being told `MAX_BODY_BYTES=0` and then
accepting 1 MiB uploads is worse than refusing to run. `MAX_QUEUE` is the one
knob where `0` is a real answer, so it accepts zero and rejects only negatives.

**Sizing.** Each thread loads the bundled font once at startup, so `MAX_CONCURRENT`
costs memory as well as CPU; match it to the container's cores rather than to
expected traffic, and use `MAX_QUEUE` for bursts.

## Notes

- **Fonts** load once at startup (bundled Vazirmatn, OFL). Without them Persian
  output is silently broken, which is the one thing this library exists to get
  right.
- **Byte-determinism** is preserved: the same request twice returns identical
  bytes. `now` is unset unless you send it, so date fields render empty by
  default — that is deliberate, not a bug.
- **The image installs the packed tarball**, not the workspace, so what runs in
  the container is the artifact consumers install.
- **No authentication.** Put it behind your own gateway; the limits here bound
  resource use, not access.

## Tests

- `npx jest --selectProjects render-service` — the request rules and the pool's
  decisions (dispatch, shedding, termination on timeout, thread replacement),
  with injected fake threads so neither needs the engine.
- `npm run smoke:render-service` — end-to-end: packs the dist, installs it,
  starts the server, talks HTTP to it. Run `npm run build:core` first.
