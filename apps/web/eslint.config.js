// apps/web eslint config — extends @modubiz/eslint-config
import modubizConfig from '@modubiz/eslint-config';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.next/**', 'next-env.d.ts', 'coverage/**'],
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
          // Node scripts (e.g. scripts/next-build.cjs) are plain CJS outside
          // the tsconfig project — allow them like the config files below.
          // public/sw.js is the shipped service worker (verbatim, plain JS).
          allowDefaultProject: [
            'eslint.config.*',
            'postcss.config.*',
            'scripts/*.cjs',
            'scripts/*.mjs',
            'public/sw.js',
          ],
        },
      },
    },
  },
  // Next.js and config files require default exports
  {
    files: [
      'eslint.config.*', // ESLint flat config
      'src/app/**/*.{ts,tsx}', // Pages and layouts
      'src/middleware.{ts,tsx}', // Middleware
      'src/i18n/**/*.{ts,tsx}', // i18n setup
      'next.config.*', // Next.js config
      'tailwind.config.*', // Tailwind config
      'postcss.config.*', // PostCSS config (JS/CJS/ESM variants)
      'vitest.config.*', // Vitest config
      'playwright.config.*', // Playwright E2E config
      'playwright.journey.config.*', // Playwright journey E2E config
      'next-env.d.ts', // Next.js type declarations
      'src/app/manifest.ts', // Web app manifest (MetadataRoute.Manifest default export)
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
  // Plain Node.js CJS scripts (e.g. scripts/next-build.cjs) — not part of the
  // TypeScript project; process/require/console are the intended globals.
  {
    files: ['scripts/*.cjs'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  // Plain Node.js ESM scripts (scripts/generate-pwa-icons.mjs) — same treatment.
  // These are standalone tool scripts: browser-style lib DOM types don't apply
  // and console output is the CLI's interface.
  {
    files: ['scripts/*.mjs'],
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  // public/sw.js is the shipped service worker — browser globals are its
  // runtime; it is intentionally plain and ships verbatim to /sw.js. The
  // type-aware rules cannot reason about untyped Cache/Fetch APIs, so the
  // unsafe-* family is disabled here.
  {
    files: ['public/sw.js'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
];
