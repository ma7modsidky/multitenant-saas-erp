// apps/web/vitest.config.ts
// Vitest config for the web app — extends workspace defaults.
// The workspace config in vitest.workspace.ts handles most settings.
// Only web-specific overrides go here.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    name: 'web',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000',
      },
    },
  },
});
