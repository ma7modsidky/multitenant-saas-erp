// Vitest Integration Test Configuration
// Separated from the main workspace so integration tests (which require Docker/Testcontainers)
// only run when explicitly invoked via `vitest run --config vitest.integration.config.ts`
// or through the `test:integration` npm script.
//
// NOTE: `root` is pinned to this file's directory (the repo root). Integration tests live
// in tests/integration/, and the runner may be invoked from a package directory (e.g.
// `pnpm --filter api test:integration` runs from apps/api), so include/exclude patterns
// must resolve against the repo root rather than process.cwd().

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['tests/integration/**/*.test.ts'],
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
