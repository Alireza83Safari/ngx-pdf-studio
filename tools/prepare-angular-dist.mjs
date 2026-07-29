/**
 * Prepare `dist/packages/pdf-studio/angular` as a publish-ready package, the
 * mirror of `prepare-core-dist.mjs` (ADR-0005). ng-packagr emits a correct APF
 * bundle but carries the source manifest through verbatim, which leaves two
 * things wrong for a real publish:
 *
 *  1. `dependencies["@ngx-pdf-studio/core"]` is `"*"` — the range that makes npm
 *     workspaces link the local core during development. Published as-is it
 *     would let `npm i @ngx-pdf-studio/angular` pull **any** core version,
 *     including one whose engine API this build was never compiled against.
 *     Both packages are released from the same tag, so it is pinned to `^` the
 *     version being cut.
 *  2. No LICENSE/README — npm would show the package with neither.
 *
 * Publish with `npm publish dist/packages/pdf-studio/angular`.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist/packages/pdf-studio/angular');

const manifest = join(dist, 'package.json');
const pkg = JSON.parse(readFileSync(manifest, 'utf8'));

const version = pkg.version;
if (!version || version === '0.0.0') {
  // Not fatal: a local `npm run build` legitimately produces 0.0.0. Only the
  // release workflow stamps a real version, and only that output is published.
  console.warn(`angular dist: version is ${version} — local build, not publishable`);
}

const coreRange = version && version !== '0.0.0' ? `^${version}` : '*';
if (pkg.dependencies?.['@ngx-pdf-studio/core']) {
  pkg.dependencies['@ngx-pdf-studio/core'] = coreRange;
}

writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);

copyFileSync(join(root, 'LICENSE'), join(dist, 'LICENSE'));
copyFileSync(join(root, 'README.md'), join(dist, 'README.md'));

console.log(`angular dist prepared at ${dist} (core pinned to ${coreRange})`);
