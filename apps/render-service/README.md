# PDF Studio render service

`POST /render {template, data}` → PDF. One container, any stack: design in the
browser, generate on a server that need not be Node.

Built on `node:http` with no framework — the surface is two routes and a body
limit, so a dependency tree would cost more than it saves.

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

`{ "ok": true, "inFlight": 0 }`. Answers `HEAD` too, which is what most probes
actually send.

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

| variable            | default   | notes                                  |
| ------------------- | --------- | -------------------------------------- |
| `PORT`              | `3000`    |                                        |
| `MAX_BODY_BYTES`    | `1048576` | 1 MiB — templates are JSON, not media  |
| `RENDER_TIMEOUT_MS` | `15000`   |                                        |
| `MAX_CONCURRENT`    | `4`       | over this, shed load rather than queue |

A variable that is set but not a positive number stops the service at startup
rather than silently falling back — being told `MAX_BODY_BYTES=0` and then
accepting 1 MiB uploads is worse than refusing to run.

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

- `npx jest --selectProjects render-service` — the request rules.
- `npm run smoke:render-service` — end-to-end: packs the dist, installs it,
  starts the server, talks HTTP to it. Run `npm run build:core` first.
