// Root ESLint Configuration
// Extends @modubiz/eslint-config per PLAN.md §0.4.1
//
// This config is used when running `pnpm lint` from the root.
// Each app/package may also have its own eslint.config.js that extends this one.

import modubizConfig from '@modubiz/eslint-config';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/pnpm-lock.yaml',
      'pnpm-lock.yaml',
    ],
  },
  ...modubizConfig,
];
