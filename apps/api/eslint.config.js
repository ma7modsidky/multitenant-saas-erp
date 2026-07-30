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
          allowDefaultProject: ['eslint.config.*'],
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
];
