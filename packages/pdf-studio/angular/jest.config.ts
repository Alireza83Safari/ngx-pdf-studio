import type { Config } from 'jest';

/**
 * Angular package tests run under jsdom with jest-preset-angular (TestBed).
 * `@ngx-pdf-studio/core` resolves to its workspace source so the engine and
 * bindings are tested together.
 *
 * ## The "worker process has failed to exit gracefully" warning
 *
 * This project prints it whenever Jest uses a worker (two or more spec files).
 * It is **not** a leak in this repo, and chasing it in these tests is wasted
 * time — that was established rather than assumed:
 *
 *  - `--detectOpenHandles` reports nothing, and it forces `--runInBand`, where
 *    the warning cannot appear at all;
 *  - dropping in two spec files containing nothing but `expect(1).toBe(1)` —
 *    no TestBed, no component, no engine, no timer — reproduces it exactly.
 *
 * So it comes from the environment the preset installs: `setupZoneTestEnv()`
 * patches the globals, and the worker does not unwind cleanly afterwards. Jest
 * waits out its grace period and force-exits, which is harmless — the run has
 * already finished and reported.
 *
 * Here it is deterministic: 5 runs, 5 warnings. Elsewhere it is not the same
 * thing — the `designer` project (plain `node` environment, no preset) emitted
 * it once under load and not once in five clean runs. Seeing it there is a
 * loaded machine, not this; seeing it here is normal.
 *
 * Deliberately **not** silenced with `forceExit: true`. That flag would hide
 * this message and every future real leak with it, and a real leak in these
 * tests is exactly the thing worth hearing about.
 */
const config: Config = {
  displayName: 'angular',
  preset: 'jest-preset-angular',
  rootDir: '.',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  moduleNameMapper: {
    '^@ngx-pdf-studio/core$': '<rootDir>/../core/src/index.ts',
  },
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        // `isolatedModules` (transpile-only) lives in that tsconfig now: ts-jest
        // deprecated the transform option and removes it in v30.
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  testMatch: ['**/?(*.)+(spec).ts'],
  // `jest-preset-angular` replaces the workspace preset, so the shared
  // `collectCoverageFrom` does not reach here — without it the engine sources
  // pulled in through the moduleNameMapper would be counted as this package's.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
    '!src/public-api.ts',
    '!src/test-setup.ts',
  ],
  // The bindings had no gate at all while core had one, which made the README's
  // "behind a CI gate" true of only half the published surface. Same shape as
  // core's: a 90% bar with branches a notch lower (currently 94/70/100/94).
  coverageThreshold: {
    global: { statements: 90, functions: 90, lines: 90, branches: 65 },
  },
};

export default config;
