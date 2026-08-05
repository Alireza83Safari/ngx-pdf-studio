import type { Config } from 'jest';

/**
 * The render service's request logic (designer-ux 5.3).
 *
 * `service.js` deliberately requires neither `http` nor the engine, so the
 * decisions a public endpoint gets wrong — body limits, envelope shape, status
 * codes — are assertable without opening a port or rendering a PDF. The
 * end-to-end check (`tools/smoke-render-service.mjs`) covers the wiring.
 */
const config: Config = {
  displayName: 'render-service',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/**/*.spec.js'],
};

export default config;
