// Vitest Workspace Configuration
// Defines project-level test configurations for the monorepo.
//
// Coverage thresholds per TESTING.md §2:
// - modules/*/domain/: 95% line, 90% branch
// - modules/*/application/: 90% line, 85% branch
// - core/: 90% line, 85% branch
// - packages/money, packages/contracts: 95% line, 90% branch
// - Overall: 80% line, 75% branch

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Root-level shared config
  {
    test: {
      name: 'root',
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
      include: ['**/__tests__/arch/**/*.spec.ts', '**/*.arch.spec.ts'],
      coverage: {
        enabled: false,
      },
    },
  },

  // Integration and isolation tests are configured in their own config files:
  //   vitest.integration.config.ts — run via `pnpm test:integration`
  //   vitest.isolation.config.ts  — run via `pnpm test:isolation`
  // They are kept out of the workspace to prevent accidental execution during
  // the default `pnpm test` run (which doesn't have Docker/Testcontainers on CI).
]);
