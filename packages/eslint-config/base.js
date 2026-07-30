// @modubiz/eslint-config/base.js
// Base ESLint config: TypeScript + core rules from CODING_STANDARDS.md
// Boundary rules (import restrictions) are in index.js

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    rules: {
      // CODING_STANDARDS.md §1 — TypeScript
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression',
          message: 'Avoid `as` casts — use Zod parse and narrow, or branded types. If unavoidable, add an eslint-disable with a reason.',
        },
      ],

      // CODING_STANDARDS.md §8 — Logging
      'no-console': 'error',

      // CODING_STANDARDS.md §9 — Async
      '@typescript-eslint/no-floating-promises': 'error',
      'no-async-promise-executor': 'error',

      // CODING_STANDARDS.md §7 — Errors
      'no-empty': ['error', { allowEmptyCatch: false }],

      // General
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
);
