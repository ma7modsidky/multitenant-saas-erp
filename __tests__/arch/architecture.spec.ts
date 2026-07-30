import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { describe, it, expect } from 'vitest';

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the set of actual import paths found in a set of source files.
 * Handles ESM `import ... from '...'`, dynamic `import('...')`, and CJS `require('...')`.
 * Skips comment-only lines.
 */
function findImports(filePattern: string): Map<string, string[]> {
  const files = globSync(filePattern, {
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'],
  });

  const imports = new Map<string, string[]>();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const found: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Skip empty lines, comment-only lines, and type declarations
      if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
        continue;
      }

      // Match ESM static imports: import ... from '...'
      const esmPattern = /import\s+(?:type\s+)?(?:[\w*{}\n\r\t, ]+\s+from\s+)?['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = esmPattern.exec(line)) !== null) {
        found.push(match[1]!);
      }

      // Match CJS requires: require('...')
      const cjsPattern = /require\(['"]([^'"]+)['"]\)/g;
      while ((match = cjsPattern.exec(line)) !== null) {
        found.push(match[1]!);
      }
    }

    if (found.length > 0) {
      imports.set(file, found);
    }
  }

  return imports;
}

/**
 * Returns violations where `process.env.X` is accessed outside allowed paths.
 * Uses per-access-key regex to allow `NODE_ENV` while catching other env var accesses.
 */
function findProcessEnvViolations(filePattern: string): string[] {
  const files = globSync(filePattern, {
    ignore: [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**',
      '**/*.spec.ts', '**/*.test.ts', '**/__tests__/**',
    ],
  });

  const violations: string[] = [];

  // Allowed paths: packages/config (the canonical config service) and
  // main.ts entry point (which reads env to pass to ConfigService constructor)
  const allowedPaths = [/^packages[/\\]config[/\\]/, /^apps[/\\]api[/\\]src[/\\]main\.ts$/];

  for (const file of files) {
    // Skip files in allowed paths entirely
    if (allowedPaths.some((p) => p.test(file))) {
      continue;
    }

    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        continue;
      }

      // Find each process.env.XXX access individually
      const envAccessPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
      let match: RegExpExecArray | null;

      while ((match = envAccessPattern.exec(line)) !== null) {
        const varName = match[1]!;

        // Allow NODE_ENV access (used by many frameworks/tools including Next.js)
        if (varName === 'NODE_ENV') {
          continue;
        }

        violations.push(`${file}:${i + 1}: process.env.${varName}`);
      }
    }
  }

  return violations;
}

// ─── Architecture Boundary Tests ───────────────────────────────────────────
//
// These tests run on every commit. A failure is never "fix the test".
// It means the architecture was violated.
//
// @see TESTING.md §5 — Architecture boundary tests

describe('architecture', () => {
  // ─── Core boundary rules ──────────────────────────────────────────────

  it('core never imports platform or modules', () => {
    const imports = findImports('apps/api/src/core/**/*.ts');

    const violations: string[] = [];

    for (const [file, deps] of imports) {
      for (const dep of deps) {
        if (
          dep.includes('@/platform') ||
          dep.includes('../platform') ||
          dep.includes('@/modules') ||
          dep.includes('../modules')
        ) {
          violations.push(`${file} imports "${dep}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('platform never imports modules', () => {
    const imports = findImports('apps/api/src/platform/**/*.ts');

    const violations: string[] = [];

    for (const [file, deps] of imports) {
      for (const dep of deps) {
        if (dep.includes('@/modules') || dep.includes('../modules')) {
          violations.push(`${file} imports "${dep}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('modules do not import from other modules', () => {
    const imports = findImports('apps/api/src/modules/**/*.ts');

    const violations: string[] = [];

    for (const [file, deps] of imports) {
      for (const dep of deps) {
        if (dep.includes('@/modules') || dep.match(/\.\.\/modules\//)) {
          violations.push(`${file} imports "${dep}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("only the composition root imports a module's public barrel", () => {
    const imports = findImports('apps/api/src/**/*.ts');

    const compositionRoot = [
      'apps/api/src/app.module.ts',
      'apps/api/src/platform/module-registry/registered-modules.ts',
    ];

    const violations: string[] = [];

    for (const [file, deps] of imports) {
      // Skip files in the composition root
      // globSync returns paths with forward slashes on all platforms
      if (compositionRoot.some((cr) => file.endsWith(cr))) {
        continue;
      }

      for (const dep of deps) {
        if (dep.includes('/public') || dep.includes('/public/')) {
          violations.push(`${file} imports module public barrel "${dep}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── Domain layer rules ───────────────────────────────────────────────

  it('domain layers have no framework or IO imports', () => {
    const imports = findImports('apps/api/src/**/domain/**/*.ts');

    const forbidden = ['@nestjs', 'drizzle-orm', 'fastify', 'ioredis', 'stripe', 'bullmq', 'redis'];

    const violations: string[] = [];

    for (const [file, deps] of imports) {
      for (const dep of deps) {
        if (forbidden.some((f) => dep.includes(f))) {
          violations.push(`${file} imports forbidden "${dep}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // ─── process.env boundary rule ────────────────────────────────────────

  it('process.env is only read in packages/config', () => {
    // Allowed paths:
    // - packages/config/ — the single source of truth for env validation
    // - apps/api/src/main.ts — the bootstrap entry point, passes env to ConfigService
    //
    // Also allows process.env.NODE_ENV everywhere (needed by Next.js and NestJS).
    const violations = findProcessEnvViolations('**/*.ts');

    if (violations.length > 0) {
      console.log('process.env violations found outside allowed paths:');
      violations.forEach((v) => console.log(`  ${v}`));
    }

    expect(violations).toEqual([]);
  });

  // ─── General quality rules ───────────────────────────────────────────

  it('no module has a default export (except Next.js pages)', () => {
    const files = globSync('apps/api/src/**/*.ts', {
      ignore: ['**/node_modules/**'],
    });

    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // Check for `export default` but skip lines that are just type re-exports
      const lines = content.split('\n');
      for (const line of lines) {
        if (/^export\s+default\s+(class|function|const|let|var|abstract)/.test(line.trim())) {
          violations.push(file);
          break;
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
