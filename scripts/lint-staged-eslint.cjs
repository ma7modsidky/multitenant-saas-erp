// @ts-check
/**
 * lint-staged ESLint runner for the pnpm workspace.
 *
 * `pnpm lint` (turbo) lints each package from its own root using that
 * package's eslint.config.js. This helper mirrors that behaviour for the
 * staged files only: it groups files by the nearest package that owns an
 * eslint.config.js and runs `npx eslint` with the package directory as cwd
 * (so config-relative `files` globs and the TypeScript project service
 * resolve correctly).
 *
 * Root-level files (e.g. vitest configs, __tests__/arch, tests/integration)
 * have no owning package and are intentionally skipped — they are outside the
 * coverage of `pnpm lint` too.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = process.cwd();
const files = process.argv.slice(2);

function packageRootFor(file) {
  let dir = path.dirname(path.resolve(repoRoot, file));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'eslint.config.js')) && dir !== repoRoot) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

const byRoot = new Map();
for (const file of files) {
  const root = packageRootFor(file);
  if (!root) continue;
  if (!byRoot.has(root)) byRoot.set(root, []);
  byRoot.get(root).push(file);
}

let failed = false;
for (const [root, pkgFiles] of byRoot) {
  const rel = pkgFiles.map((f) =>
    path.relative(root, path.resolve(repoRoot, f)).split(path.sep).join('/'),
  );
  const quoted = rel.map((f) => `"${f}"`).join(' ');
  const result = spawnSync(`npx eslint ${quoted}`, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
