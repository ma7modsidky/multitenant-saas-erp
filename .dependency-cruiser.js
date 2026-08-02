// Dependency Cruiser Configuration
// Encodes architecture boundary rules from ARCHITECTURE.md §2-3 and TESTING.md §5.
//
// Rules enforced:
// - core/ must never import platform/ or modules/
// - Modules must not import from other modules directly
// - Domain layers must not import framework or IO modules
// - Only the composition root may import module public barrels

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // === Core boundary rules ===

    // Rule: core/ never imports platform/ or modules/
    {
      name: 'core-no-import-platform-or-modules',
      comment: 'core/ must not import from platform/ or modules/. Depend inward.',
      severity: 'error',
      from: { path: '^apps/api/src/core/' },
      to: {
        path: '^(apps/api/src/platform/|apps/api/src/modules/)',
      },
    },

    // Rule: platform/ never imports modules/
    {
      name: 'platform-no-import-modules',
      comment: 'platform/ must not import from modules/. Depend inward.',
      severity: 'error',
      from: { path: '^apps/api/src/platform/' },
      to: { path: '^apps/api/src/modules/' },
    },

    // Rule: No module imports another module
    {
      name: 'module-no-import-other-module',
      comment:
        'Modules must not import from other modules directly. Use events or declared ports from @modubiz/contracts.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/((?!\\1)[^/]+)/',
      },
    },

    // === Layer boundary rules ===

    // Rule: domain/ has no framework or IO imports
    {
      name: 'domain-no-framework-imports',
      comment: 'Domain layer must not import framework, database, or IO modules (CODING_STANDARDS.md §4).',
      severity: 'error',
      from: { path: '^apps/api/src/(core|modules/[^/]+)/domain/' },
      to: {
        dependencyTypes: ['npm'],
        path: ['@nestjs/', 'drizzle-orm', 'ioredis', 'fastify', 'stripe', 'bullmq'],
      },
    },

    // Rule: domain/ never imports infrastructure/
    {
      name: 'domain-no-import-infrastructure',
      comment: 'Domain layer must not import infrastructure layer.',
      severity: 'error',
      from: { path: '^apps/api/src/(core|modules/[^/]+)/domain/' },
      to: { path: '^apps/api/src/(core|modules/[^/]+)/infrastructure/' },
    },

    // === Module public barrel import restriction ===

    // Rule: Only composition root imports module public barrels
    {
      name: 'module-public-only-from-composition-root',
      comment: "Only the composition root (app.module.ts, registered-modules.ts) may import a module's public barrel.",
      severity: 'error',
      from: {
        pathNot: '^(apps/api/src/app\\.module\\.ts|apps/api/src/platform/module-registry/registered-modules\\.ts)$',
      },
      to: {
        path: '/modules/[^/]+/public/',
      },
    },

    // === General quality rules ===

    // Rule: No circular dependencies
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden. They cause runtime issues and make extraction impossible.',
      from: {},
      to: {
        circular: true,
      },
    },

    // Rule: No orphan modules (files not in the dependency graph)
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphan files (not imported by anything) may be dead code.',
      from: {
        orphan: true,
        pathNot: [
          '\\.spec\\.ts$',
          '\\.test\\.ts$',
          '^(apps/api/src/main\\.ts)$',
          '^(apps/web/src/app/.*)$',
          '\\.eslintrc',
          '\\.prettierrc',
          'vite\\.config',
          'vitest\\.workspace',
          '\\.dependency-cruiser',
          'commitlint\\.config',
          '\\.lintstagedrc',
        ],
      },
      to: {},
    },

    // Rule: Production code should not import dev dependencies
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Production modules should not import dev dependencies.',
      from: {
        pathNot: [
          '\\.spec\\.ts$',
          '\\.test\\.ts$',
          '^tooling/',
          'vitest\\.workspace\\.ts$',
          '\\.lintstagedrc\\.js$',
          'commitlint\\.config\\.js$',
        ],
      },
      to: {
        dependencyTypes: ['npm-dev'],
      },
    },
  ],

  options: {
    doNotFollow: 'node_modules',
    includeOnly: '^(apps|packages)',
    exclude: {
      path: 'dist/',
    },
  },
};
