import type { Config } from 'jest';

/**
 * Root Jest config. Each publishable package is registered as a Jest "project"
 * so the whole suite runs with `npm test`, while `--selectProjects <name>`
 * targets a single package. New packages add themselves here as they land.
 */
const config: Config = {
  // Font embedding/subsetting (fontkit) and PDF parse (pdfjs) are CPU-heavy;
  // over-subscribing workers makes them contend and time out. Cap parallelism.
  maxWorkers: '50%',
  projects: [
    '<rootDir>/packages/pdf-studio/core/jest.config.ts',
    '<rootDir>/packages/pdf-studio/angular/jest.config.ts',
    '<rootDir>/apps/playground/designer/jest.config.ts',
    '<rootDir>/apps/render-service/jest.config.ts',
  ],
};

export default config;
