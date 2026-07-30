/**
 * Angular partial-Ivy **linker** compat smoke (§14A).
 *
 * `smoke-angular-consumer.mjs` type-checks a consumer against the published
 * `.d.ts`, which is version-agnostic — so it passes for *every* Angular major,
 * including ones that cannot build the package at all. The thing that actually
 * rejects a too-new library is the **linker**: ng-packagr emits partial-Ivy
 * declarations carrying a `minVersion`, and an application's compiler-cli looks
 * up a linker whose range covers it. Ours emit `minVersion: "14.0.0"`, so
 * Angular 12/13 fail at build time with "This application depends upon a library
 * published using Angular version …" while the type check stays green.
 *
 * This runs the real linker — the same `createEs2015LinkerPlugin` that
 * `@angular-devkit/build-angular` puts in its Babel pipeline — from a specific
 * `@angular/compiler-cli` version over the built fesm2022 bundle. It is the
 * cheapest check that can actually fail for the right reason.
 *
 * Usage: node tools/smoke-angular-linker.mjs <angularMajor|latest>
 * Requires `npm run build:angular` to have run first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(
  root,
  'dist/packages/pdf-studio/angular/fesm2022/ngx-pdf-studio-angular.mjs',
);
if (!existsSync(bundle)) {
  console.error(`angular fesm bundle missing at ${bundle} — run \`npm run build:angular\` first`);
  process.exit(1);
}

const version = process.argv[2] || 'latest';

// Each Angular major pins the TypeScript it was built against; compiler-cli
// reads the `typescript` in the tree, and a mismatched one blows up inside the
// linker rather than on our code.
const TS_FOR_ANGULAR = {
  12: '~4.3.5',
  13: '~4.5.5',
  14: '~4.8.4',
  15: '~4.9.5',
  16: '~5.1.6',
  17: '~5.4.5',
};
const major = /^\d+/.exec(version)?.[0];
const tsVersion = (major && TS_FOR_ANGULAR[major]) || 'latest';

// npm ships as `npm.cmd` on Windows, and since the CVE-2024-27980 fix Node
// refuses to spawn a `.cmd` without a shell — so Windows needs `shell: true`,
// which in turn means quoting arguments that contain whitespace (temp paths
// under a user profile routinely do). POSIX keeps the plain, unshelled call.
const isWindows = process.platform === 'win32';
const NPM = isWindows ? 'npm.cmd' : 'npm';
const npmArgs = (args) => (isWindows ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args);
const npmOpts = isWindows ? { shell: true } : {};

const work = mkdtempSync(join(tmpdir(), `ngx-pdf-studio-linker-${major ?? 'latest'}-`));
try {
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'linker-probe', private: true, version: '0.0.0' }),
  );
  execFileSync(
    NPM,
    npmArgs([
      'install',
      '--no-audit',
      '--no-fund',
      // Old compiler-cli majors declare peers our probe tree does not satisfy;
      // we are not building an app here, only loading the linker.
      '--legacy-peer-deps',
      `@angular/compiler-cli@${version}`,
      `@angular/compiler@${version}`,
      `@angular/core@${version}`,
      '@babel/core',
      `typescript@${tsVersion}`,
    ]),
    { cwd: work, stdio: 'ignore', ...npmOpts },
  );

  writeFileSync(
    join(work, 'link.cjs'),
    `
const { readFileSync } = require('fs');
const babel = require('@babel/core');
const { createEs2015LinkerPlugin } = require('@angular/compiler-cli/linker/babel');

// Angular >=13 exposes these through the \`private/localize\` barrel; 12 does not.
let ConsoleLogger, LogLevel, NodeJSFileSystem;
try {
  ({ ConsoleLogger, LogLevel, NodeJSFileSystem } = require('@angular/compiler-cli/private/localize'));
} catch {
  ({ NodeJSFileSystem } = require('@angular/compiler-cli/src/ngtsc/file_system'));
  ({ ConsoleLogger, LogLevel } = require('@angular/compiler-cli/src/ngtsc/logging'));
}

const filename = ${JSON.stringify(bundle)};
babel.transformSync(readFileSync(filename, 'utf8'), {
  filename,
  configFile: false,
  babelrc: false,
  compact: false,
  plugins: [
    createEs2015LinkerPlugin({
      fileSystem: new NodeJSFileSystem(),
      logger: new ConsoleLogger(LogLevel.warn),
      linkerJitMode: false,
      sourceMapping: false,
    }),
  ],
});
console.log('linked');
`,
  );

  execFileSync('node', ['link.cjs'], { cwd: work, stdio: 'inherit' });
  console.log(`angular linker compat OK against @angular/compiler-cli@${version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
