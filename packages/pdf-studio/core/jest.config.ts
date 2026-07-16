import type { Config } from 'jest';

const config: Config = {
  displayName: 'core',
  preset: '../../../jest.preset.js',
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // Coverage gate (§13). Statements/functions/lines hold the ≥90% engine bar;
  // the branch threshold is set a notch lower as defensive/unreachable arms
  // (e.g. the unreachable `??` switch default) legitimately depress branch %.
  coverageThreshold: {
    global: { statements: 90, functions: 90, lines: 90, branches: 80 },
  },
};

export default config;
