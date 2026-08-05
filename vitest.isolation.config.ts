// Vitest Isolation Test Configuration
// Separated from the main workspace so isolation tests (which require Docker/Testcontainers)
// only run when explicitly invoked.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'isolation',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/__tests__/isolation/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      enabled: false,
    },
    testTimeout: 180000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
