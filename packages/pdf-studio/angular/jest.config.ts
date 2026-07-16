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
        tsconfig: '<rootDir>/tsconfig.spec.json',
        // Transpile-only: the engine sources imported from `@ngx-pdf-studio/core`
        // are already fully type-checked in core's own project, so we don't
        // re-type-check them here (and avoid needing core's ambient .d.ts in this
        // program). The Angular library's own types are checked by ng-packagr.
        isolatedModules: true,
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  testMatch: ['**/?(*.)+(spec).ts'],
};

export default config;
