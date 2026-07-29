/**
 * Angular consumer type-compat smoke (§14A): packs the built APF package (plus
 * the core dist it depends on), installs both tarballs into a pristine temp
 * project against a specific `@angular/core` major, and type-checks a consumer
 * that imports the module, service, and component. This catches public-API
 * breakage against each supported Angular major (12 → latest) without needing
 * a full CLI app per version.
 *
 * Usage: node tools/smoke-angular-consumer.mjs <angularVersion|latest>
 * Requires `npm run build` (core dist + Angular APF) to have run first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ngDist = join(root, 'dist/packages/pdf-studio/angular');
const coreDist = join(root, 'packages/pdf-studio/core/dist');
const version = process.argv[2] || 'latest';

for (const [name, dir] of [
  ['angular APF', ngDist],
  ['core dist', coreDist],
]) {
  if (!existsSync(join(dir, 'package.json'))) {
    console.error(`${name} missing at ${dir} — run \`npm run build\` first`);
    process.exit(1);
  }
}

// TypeScript range each Angular major actually supports.
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

const work = mkdtempSync(join(tmpdir(), 'ngx-pdf-studio-ng-'));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: work, stdio: 'inherit', ...opts });
try {
  const pack = (dir) =>
    execFileSync(NPM, npmArgs(['pack', dir, '--pack-destination', work]), {
      encoding: 'utf8',
      ...npmOpts,
    })
      .trim()
      .split('\n')
      .pop();
  const coreTar = join(work, pack(coreDist));
  const ngTar = join(work, pack(ngDist));

  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'ng-consumer', private: true, version: '0.0.0' }),
  );
  run(
    NPM,
    npmArgs([
      'install',
      '--no-audit',
      '--no-fund',
      coreTar,
      ngTar,
      `@angular/core@${version}`,
      `@angular/common@${version}`,
      `@angular/platform-browser@${version}`,
      'rxjs@^7.4.0',
      'zone.js',
      'tslib',
      `typescript@${tsVersion}`,
    ]),
    npmOpts,
  );

  writeFileSync(
    join(work, 'consumer.ts'),
    `
import { NgModule } from '@angular/core';
import {
  PdfStudioRenderer,
  PdfStudioRendererModule,
  PdfStudioPreviewComponent,
} from '@ngx-pdf-studio/angular';
import type { PdfRenderRequest, PdfStudioResult } from '@ngx-pdf-studio/angular';
import type { PdfTemplate } from '@ngx-pdf-studio/core';

@NgModule({ imports: [PdfStudioRendererModule] })
export class ConsumerModule {}

export async function render(
  service: PdfStudioRenderer,
  template: PdfTemplate,
): Promise<PdfStudioResult> {
  const request: PdfRenderRequest = { template, data: {} };
  return service.render(request);
}

export const preview: typeof PdfStudioPreviewComponent = PdfStudioPreviewComponent;
`,
  );
  writeFileSync(
    join(work, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2019',
        module: 'ESNext',
        // TS >=5.7 removed 'node10'; old majors don't know 'bundler'.
        moduleResolution: tsVersion === 'latest' ? 'bundler' : 'node',
        strict: true,
        // Old TS majors (Angular 12/13) cannot parse modern zod typings —
        // a transitive dep — so lib checking is skipped there; our own d.ts
        // stay strict-parsed on 17/latest where skipLibCheck is off.
        skipLibCheck: tsVersion !== 'latest' && Number(major) < 16,
        experimentalDecorators: true,
        emitDecoratorMetadata: false,
        noEmit: true,
        lib: ['ES2020', 'DOM'],
      },
      include: ['consumer.ts'],
    }),
  );
  run(isWindows ? 'npx.cmd' : 'npx', ['tsc', '-p', 'tsconfig.json'], npmOpts);
  console.log(`angular consumer type-compat OK against @angular/core@${version} (ts ${tsVersion})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
