// Auto-registration logic — edits the exact files that are allowed to change
// outside the module folder:
//   1. packages/contracts/src/module/index.ts  — MODULE_KEYS entry (contract-first)
//   2. apps/api/src/platform/module-registry/registered-modules.ts — descriptor import + entry
//   3. apps/api/src/app.module.ts — module import + entry
//   4. packages/i18n/src/messages/<locale>/index.ts — modules.<key> keys (4 locales)
//
// @see MODULE_GUIDE.md §4 Step 1 (contracts) and Step 8 (registration)

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { readFile, overwriteFile, fileExists, log, REPO_ROOT } from './helpers.mjs';
import { i18nBlock } from './frontend.mjs';
import { screamingSnake } from './helpers.mjs';

/**
 * Read a file and split it into lines, preserving the original line ending
 * so we can restore it when writing back. Some repo files use CRLF (e.g.
 * apps/api/src/app.module.ts), others LF — string matching against raw
 * content silently fails across endings.
 */
function readLines(path) {
  const raw = readFile(path);
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { lines: raw.split(/\r?\n/), eol };
}

function writeLines(path, lines, eol) {
  overwriteFile(path, lines.join(eol));
}

const CONTRACTS_MODULE_INDEX = 'packages/contracts/src/module/index.ts';
const REGISTERED_MODULES = 'apps/api/src/platform/module-registry/registered-modules.ts';
const APP_MODULE = 'apps/api/src/app.module.ts';
const LOCALES = ['en', 'ar', 'fr', 'es'];

/** Ensure the key exists in MODULE_KEYS (contract-first, MODULE_GUIDE Step 1). */
export function registerModuleKey(key) {
  const path = CONTRACTS_MODULE_INDEX;
  const constant = screamingSnake(key);
  const { lines, eol } = readLines(path);
  const content = lines.join('\n');

  if (new RegExp(`\\b${constant}:\\s*'${key}'`).test(content)) {
    log(`  [skip] MODULE_KEYS.${constant} already present`);
    return;
  }

  // Insert before the closing `} as const;` of MODULE_KEYS.
  const marker = '} as const;';
  const index = content.indexOf(marker);
  if (index === -1) {
    throw new Error(`Cannot register key: "${marker}" not found in ${path}`);
  }
  const updated = `${content.slice(0, index)}  ${constant}: '${key}',\n${content.slice(index)}`;
  writeLines(path, updated.split('\n'), eol);
  log(`  [ok]   MODULE_KEYS.${constant} = '${key}' added in contracts`);
}

/** Add the descriptor to registered-modules.ts (composition root). */
export function registerDescriptor(key) {
  const path = REGISTERED_MODULES;
  const { lines, eol } = readLines(path);
  const content = lines.join('\n');
  const descriptorName = `${key}Descriptor`;

  if (content.includes(descriptorName)) {
    log(`  [skip] descriptor already registered`);
    return;
  }

  const importLine = `import { ${descriptorName} } from '../../modules/${key}/public/index.js';`;
  // Insert the import on its own line after the existing @modubiz/contracts import
  // (with a blank line between groups per import/order).
  const importAnchor = `import { defineModule, type ModuleDescriptor } from '@modubiz/contracts';`;
  if (!content.includes(importAnchor)) {
    throw new Error(`Cannot register descriptor: import anchor not found in ${path}`);
  }
  let updated = content.replace(importAnchor, `${importAnchor}\n${importLine}`);

  // Append the descriptor to REGISTERED_MODULES array (before the final `];`).
  const arrayEnd = '\n];';
  const endIndex = updated.lastIndexOf(arrayEnd);
  if (endIndex === -1) {
    throw new Error(`Cannot register descriptor: array terminator not found in ${path}`);
  }
  updated = `${updated.slice(0, endIndex)}\n  ${descriptorName},\n];`;

  writeLines(path, updated.split('\n'), eol);
  log(`  [ok]   descriptor registered in registered-modules.ts`);
}

/** Add the Nest module class to app.module.ts (composition root). */
export function registerModuleClass(key) {
  const path = APP_MODULE;
  const { lines, eol } = readLines(path);
  const content = lines.join('\n');
  const className = `${key.charAt(0).toUpperCase()}${key.slice(1)}Module`;

  if (content.includes(className)) {
    log(`  [skip] module class already registered`);
    return;
  }

  const importLine = `import { ${className} } from './modules/${key}/public/index.js';`;
  // Insert the import after the last platform import.
  const importAnchor = `import { FxRatesModule } from './platform/fx-rates/fx-rates.module.js';`;
  if (!content.includes(importAnchor)) {
    throw new Error(`Cannot register module: import anchor not found in ${path}`);
  }
  let updated = content.replace(importAnchor, `${importAnchor}\n${importLine}`);

  // Add the module class to the imports array (before the closing `  ],`).
  const importsEnd = '\n    FxRatesModule,\n  ],';
  if (!updated.includes(importsEnd)) {
    throw new Error(`Cannot register module: imports terminator not found in ${path}`);
  }
  updated = updated.replace(importsEnd, `\n    FxRatesModule,\n    ${className},\n  ],`);

  writeLines(path, updated.split('\n'), eol);
  log(`  [ok]   module class registered in app.module.ts`);
}

/** Insert modules.<key> keys into all 4 locale catalogs. */
export function registerI18nKeys(key) {
  for (const locale of LOCALES) {
    const path = `packages/i18n/src/messages/${locale}/index.ts`;
    if (!fileExists(path)) {
      log(`  [warn] locale catalog not found: ${path}`);
      continue;
    }
    const { lines, eol } = readLines(path);
    const content = lines.join('\n');
    if (content.includes(`    ${key}: {`)) {
      log(`  [skip] modules.${key} already present in ${locale}`);
      continue;
    }

    const anchor = '  modules: {';
    if (!content.includes(anchor)) {
      throw new Error(`Cannot add i18n keys: "modules:" block not found in ${path}`);
    }
    const updated = content.replace(anchor, `${anchor}\n${i18nBlock(key)}`);
    writeLines(path, updated.split('\n'), eol);
    log(`  [ok]   modules.${key} keys added to ${locale}`);
  }
}

/**
 * Rebuild the contracts package after a MODULE_KEYS edit.
 *
 * `PermissionKey` / `EventName` are template-literal unions derived from
 * `MODULE_KEYS`, and `apps/api` imports `@modubiz/contracts` from its built
 * `dist/`. Without a rebuild the newly added key never reaches the types the
 * API compiles against, so the generated descriptor fails typecheck (and a
 * watch-mode dev server crashes on reload). Verified during the demo2
 * generate→remove cycle (2026-08-02).
 */
export function rebuildContracts() {
  log('  [..]   rebuilding @modubiz/contracts (dist reflects the new MODULE_KEYS entry)...');
  const result = spawnSync('npx', ['tsc', '-b'], {
    cwd: join(REPO_ROOT, 'packages/contracts'),
    stdio: 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(
      `Contracts rebuild failed (exit ${result.status}). ` +
        `Stderr:\n${result.stderr ?? ''}\nStdout:\n${result.stdout ?? ''}`,
    );
  }
  log('  [ok]   contracts rebuilt');
}

/** Run all registration steps. */
export function register(key) {
  log('Registering module in the composition root + contracts + i18n:');
  registerModuleKey(key);
  registerDescriptor(key);
  registerModuleClass(key);
  registerI18nKeys(key);

  // The contracts edit must be compiled before the module can typecheck.
  rebuildContracts();
}
