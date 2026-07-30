// apps/web eslint config — extends @modubiz/eslint-config
import modubizConfig from '@modubiz/eslint-config';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.next/**',
      'next-env.d.ts',
    ],
  },
  ...modubizConfig,
  // Override projectService AFTER the base config to add allowDefaultProject
  // (base config sets projectService: true which would override earlier configs)
  // Note: `**` globs are disallowed in allowDefaultProject for performance reasons.
  // Most files are covered by tsconfig's `**/*.ts` include.
  // Only files NOT in the tsconfig need explicit allowance here.
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.*', 'postcss.config.*'],
        },
      },
    },
  },
  // Next.js and config files require default exports
  {
    files: [
      'eslint.config.*',               // ESLint flat config
      'src/app/**/*.{ts,tsx}',        // Pages and layouts
      'src/middleware.{ts,tsx}',       // Middleware
      'src/i18n/**/*.{ts,tsx}',        // i18n setup
      'next.config.*',                 // Next.js config
      'tailwind.config.*',             // Tailwind config
      'postcss.config.*',              // PostCSS config (JS/CJS/ESM variants)
      'vitest.config.*',               // Vitest config
      'next-env.d.ts',                 // Next.js type declarations
    ],
    rules: {
      'import/no-default-export': 'off',
    },
  },
  // Dynamic import patterns in i18n setup are intentional
  {
    files: ['src/i18n/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
];
