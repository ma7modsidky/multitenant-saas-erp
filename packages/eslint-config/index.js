// @modubiz/eslint-config/index.js
// Full ESLint config: base rules + boundary import restrictions per ARCHITECTURE.md
// This is the main entry point used by apps and packages.

import base from './base.js';
import importPlugin from 'eslint-plugin-import';

export default [
  ...base,
  importPlugin.flatConfigs.recommended,
  {
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      // === Import rules ===

      // Module boundary enforcement: no cross-module imports
      'import/no-restricted-paths': [
        'error',
        {
          // core/ must never import platform/ or modules/
          zones: [
            {
              target: 'apps/api/src/core',
              from: 'apps/api/src/platform',
              message: 'core/ must not import from platform/. Depend inward.',
            },
            {
              target: 'apps/api/src/core',
              from: 'apps/api/src/modules',
              message: 'core/ must not import from modules/. Depend inward.',
            },
            {
              target: 'apps/api/src/platform',
              from: 'apps/api/src/modules',
              message: 'platform/ must not import from modules/. Depend inward.',
            },
          ],
        },
      ],

      // No module imports another module's source
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*'],
              message:
                'Modules must not import from other modules directly. Use events or declared ports from @modubiz/contracts.',
            },
            {
              group: ['@/platform/*'],
              message: 'Modules must not import from platform/. Use core/ abstractions instead.',
            },
          ],
        },
      ],

      // Enforce correct import ordering
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // No default exports (except Next.js pages/layouts)
      'import/no-default-export': 'error',

      // No cycles
      'import/no-cycle': ['error', { maxDepth: Infinity }],

      // === Tailwind CSS / RTL rules ===

      // Note: RTL enforcement is handled via no-restricted-syntax in app-specific overrides below.
      // eslint-plugin-tailwindcss flat config API varies by version; we use manual rules instead.

      // === Additional quality rules ===

      // No floating promises
      '@typescript-eslint/no-floating-promises': 'error',

      // No unsafe assignments
      '@typescript-eslint/no-unsafe-assignment': 'error',

      // No await inside loops over unbounded input
      'no-await-in-loop': 'warn',

      // Max file/function sizes (CODING_STANDARDS.md §3)
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', 3],
      complexity: ['warn', 10],

      // No console.log (CODING_STANDARDS.md §8)
      'no-console': 'error',
    },
  },

  // === API app specific rules ===
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      // Only composition root may import module public barrels
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/public'],
              message:
                "Only the composition root (app.module.ts and registered-modules.ts) may import a module's public barrel.",
            },
          ],
        },
      ],
    },
  },

  // === Frontend specific rules ===
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      // Allow default exports for Next.js pages/layouts
      'import/no-default-export': 'off',

      // Ban directional CSS utilities (RTL safety per CODING_STANDARDS.md §10)
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXAttribute[name.name=/^(className|class)$/] Literal[value=/\\\\b(ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)\\\\b/]',
          message: 'Use logical CSS utilities (ms-, me-, ps-, pe-, start-, end-, text-start, text-end) for RTL safety.',
        },
      ],
    },
  },

  // === Test file overrides ===
  {
    files: ['**/*.{spec,test}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      // Tests may use console for debugging
      'no-console': 'off',
      // Tests may have larger functions
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      // Allow non-null assertions in tests
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Allow any in tests
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
