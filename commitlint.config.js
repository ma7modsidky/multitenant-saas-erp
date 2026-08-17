// @ts-check

/**
 * commitlint configuration
 * Enforces Conventional Commits format per CODING_STANDARDS.md §13
 *
 * Format: <type>(<scope>): <subject>
 * Types: feat | fix | refactor | perf | test | docs | chore | build | ci
 * Scope: module or package name
 * Subject: imperative, lowercase, no trailing period
 *
 * Examples:
 *   feat(inventory): add stock reservation expiry job
 *   fix(pos): prevent duplicate receipt numbers on offline sync
 *   refactor(crm): extract deal stage transition into domain entity
 *   docs(architecture): clarify level-3 port justification
 *   test(inventory): add tenant isolation coverage for stock levels
 *   chore(deps): bump drizzle-orm to 0.36
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'chore', 'build', 'ci']],
    'scope-enum': [
      2,
      'always',
      [
        'core',
        'platform',
        'crm',
        'inventory',
        'pos',
        'accounting',
        'api',
        'web',
        'contracts',
        'db',
        'config',
        'money',
        'i18n',
        'ui',
        'api-client',
        'deps',
        'ci',
        'docs',
        'generator',
        'tooling',
      ],
    ],
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-length': [0],
    'body-max-line-length': [2, 'always', 100],
  },
};
