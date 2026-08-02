// @ts-check

/**
 * lint-staged configuration
 * Runs on staged files before commit (via Husky).
 *
 * Order matters:
 * 1. Format with Prettier (fast, non-breaking)
 * 2. Lint with ESLint (slower, may find issues)
 */
module.exports = {
  '*.{ts,tsx,js,jsx}': ['prettier --write', 'node scripts/lint-staged-eslint.cjs'],
  '*.{md,json,yml,yaml}': ['prettier --write'],
  '*.css': ['prettier --write'],
};
