import type { Config } from 'jest';

/**
 * Angular package tests run under jsdom with jest-preset-angular (TestBed).
 * `@ngx-pdf-studio/core` resolves to its workspace source so the engine and
 * bindings are tested together.
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
