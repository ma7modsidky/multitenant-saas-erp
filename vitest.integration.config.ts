// Vitest Integration Test Configuration
// Separated from the main workspace so integration tests (which require Docker/Testcontainers)
// only run when explicitly invoked via `vitest run --config vitest.integration.config.ts`
// or through the `test:integration` npm script.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts', '**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      enabled: false,
    },
    globals: true,
    testTimeout: 180000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
