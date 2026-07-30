// apps/api eslint config — extends @modubiz/eslint-config
import modubizConfig from '@modubiz/eslint-config';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  ...modubizConfig,
  // Override projectService AFTER the base config to add allowDefaultProject
  // (base config sets projectService: true which would override earlier configs)
  // Note: `**` globs are disallowed in allowDefaultProject for performance reasons.
  // Most files are covered by tsconfig's `src/**/*.ts` include.
  // Only files NOT in the tsconfig need explicit allowance here.
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.*', '__tests__/integration/*.test.ts'],
        },
      },
    },
  },
  {
    files: ['src/main.ts'],
    rules: {
      // Allow console.log in the bootstrap entry point
      'no-console': 'off',
    },
  },
  // API files that need default exports (ESLint config + NestJS modules/controllers)
  {
    files: [
      'eslint.config.*',               // ESLint flat config
      'src/**/*.module.ts', 'src/**/*.controller.ts', 'src/**/*.service.ts',
      'src/**/*.guard.ts', 'src/**/*.decorator.ts', 'src/**/*.filter.ts',
      'src/**/*.interceptor.ts', 'src/**/*.middleware.ts', 'src/**/*.pipe.ts',
      'src/**/*.strategy.ts',
    ],
    rules: {
      'import/no-default-export': 'off',
    },
  },
  // Relax strict rules for Phase 1 integration test files (outside src/)
  {
    files: ['__tests__/**/*.ts'],
    rules: {
      // All src/ relaxed rules apply here too
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Relax strict rules for Phase 1 source files
  // TODO: Remove these overrides and fix source code in Phase 2
  // Pre-existing violations from initial implementation — will be fixed incrementally
  {
    files: ['src/**/*.ts'],
    rules: {
      // Phase 1 code uses `as` casts extensively on request/response objects
      'no-restricted-syntax': 'off',
      // Decorated methods and callbacks return noop promises
      '@typescript-eslint/require-await': 'off',
      // EventEmitter2 and other class method references
      '@typescript-eslint/unbound-method': 'off',
      // Interacting with Fastify/Express request objects typed as any
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Accessing request.user and other dynamic properties
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // Unused variables in scaffolded code (to be cleaned up)
      '@typescript-eslint/no-unused-vars': 'off',
      // Non-null assertions on optional chaining results
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Promise-returning callbacks in Observable patterns
      '@typescript-eslint/no-misused-promises': 'off',
      // Floating promises in event handler callbacks
      '@typescript-eslint/no-floating-promises': 'off',
      // Unsafe return types in dynamically typed callbacks
      '@typescript-eslint/no-unsafe-return': 'off',
      // Unsafe call patterns on dynamically imported modules
      '@typescript-eslint/no-unsafe-call': 'off',
      // Unsafe argument passing through generic middleware
      '@typescript-eslint/no-unsafe-argument': 'off',
      // Console.log in non-entry-point files (to be replaced with logger in Phase 2)
      'no-console': 'off',
      // Redundant type constituents in complex conditional types
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },
];
