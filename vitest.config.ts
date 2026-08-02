// Vitest Root Configuration
// Defines project-level test configurations for the monorepo.
//
// NOTE: this replaces the legacy `vitest.workspace.ts`. Vitest 3.x deprecates
// workspace files, and — critically — an auto-detected workspace file takes
// precedence over an explicit `--config` flag. That silently turned
// `pnpm test:integration` (vitest run --config vitest.integration.config.ts)
// into a re-run of the unit workspace suite, so integration tests never
// executed. Keeping the projects in the root config restores normal config
// resolution: explicit configs (integration, isolation) now win as intended.
//
// `root` is pinned to this file's directory (the repo root) because the
// runner may be invoked from a package directory (e.g. `pnpm --filter api
// test` runs from apps/api), and project include/exclude patterns must
// resolve against the repo root rather than process.cwd().
//
// Coverage thresholds per TESTING.md §2:
// - modules/*/domain/: 95% line, 90% branch
// - modules/*/application/: 90% line, 85% branch
// - core/: 90% line, 85% branch
// - packages/money, packages/contracts: 95% line, 90% branch
// - Overall: 80% line, 75% branch

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      // Root-level shared config
      {
        test: {
          name: 'root',
          root: ROOT,
          include: [
            'apps/api/src/**/*.spec.ts',
            'apps/web/**/*.spec.ts',
            'apps/web/**/*.spec.tsx',
            'packages/**/*.spec.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e.spec.ts'],
          coverage: {
            provider: 'v8',
            enabled: true,
            reporter: ['text', 'json', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['apps/**/src/**', 'packages/**'],
            exclude: [
              '**/*.spec.ts',
              '**/*.spec.tsx',
              '**/*.test.ts',
              '**/__tests__/**',
              '**/dist/**',
              '**/node_modules/**',
              'packages/api-client/**', // generated
              '**/*.dto.ts',
              '**/*.migration.ts',
            ],
            thresholds: {
              global: {
                lines: 80,
                branches: 75,
                functions: 80,
                statements: 80,
              },
            },
          },
          globals: true,
          environment: 'node',
          setupFiles: [],
        },
      },

      // Core package config
      {
        test: {
          name: 'core',
          root: ROOT,
          include: ['apps/api/src/core/**/*.spec.ts'],
          coverage: {
            thresholds: {
              'apps/api/src/core/**/*.ts': {
                lines: 90,
                branches: 85,
                functions: 90,
                statements: 90,
              },
            },
          },
        },
      },

      // Money package config
      {
        test: {
          name: 'money',
          root: ROOT,
          include: ['packages/money/**/*.spec.ts'],
          coverage: {
            thresholds: {
              'packages/money/**/*.ts': {
                lines: 95,
                branches: 90,
                functions: 95,
                statements: 95,
              },
            },
          },
        },
      },

      // Contracts package config
      {
        test: {
          name: 'contracts',
          root: ROOT,
          include: ['packages/contracts/**/*.spec.ts'],
          coverage: {
            thresholds: {
              'packages/contracts/**/*.ts': {
                lines: 95,
                branches: 90,
                functions: 95,
                statements: 95,
              },
            },
          },
        },
      },

      // Architecture tests (separate suite, no coverage)
      {
        test: {
          name: 'arch',
          root: ROOT,
          include: ['**/__tests__/arch/**/*.spec.ts', '**/*.arch.spec.ts'],
          coverage: {
            enabled: false,
          },
        },
      },
    ],
  },
});

// Integration and isolation tests are configured in their own config files:
//   vitest.integration.config.ts — run via `pnpm test:integration`
//   vitest.isolation.config.ts  — run via `pnpm test:isolation`
// They are kept out of the default projects so they only run when explicitly
// invoked (they require Docker/Testcontainers on CI).
