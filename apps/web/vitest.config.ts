// apps/web/vitest.config.ts
// Vitest config for the web app — extends workspace defaults.
// The workspace config in vitest.workspace.ts handles most settings.
// Only web-specific overrides go here.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'web',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    globals: true,
  },
});
