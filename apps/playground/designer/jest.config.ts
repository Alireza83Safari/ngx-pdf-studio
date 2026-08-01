import type { Config } from 'jest';

/**
 * The designer's own unit tests (designer-ux 4.1).
 *
 * `designer.js` is a single IIFE, so its logic was unreachable from a test and
 * ~5,500 lines shared one jsdom smoke test. The pure parts now live in
 * `designer-util.js` and are asserted directly here; the smoke test stays as
 * the integration check that they are wired up correctly.
 *
 * Plain JavaScript, no transform: these files are what the browser loads.
 */
const config: Config = {
  displayName: 'designer',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/**/*.spec.js'],
};

export default config;
