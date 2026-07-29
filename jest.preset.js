/**
 * Shared Jest preset for all packages in the workspace.
 *
 * Pure-TS packages (`core`, `pdf`) use the `node` test environment so they can
 * be exercised exactly as they run on the Node server path (§3 headless parity).
 * Angular packages (`designer`, `renderer`) override `testEnvironment` to
 * `jsdom` in their own jest.config.ts.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
    '!src/**/*.d.ts',
    // Test-only helpers (golden harness) — not shipped, not part of the gate.
    '!src/**/testing/**',
  ],
  coverageReporters: ['text', 'lcov'],
};
