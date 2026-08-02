#!/usr/bin/env node
// ModuBiz module generator — `pnpm generate:module <key>`.
//
// Scaffolds the canonical module skeleton (MODULE_GUIDE.md §3) and auto-registers
// the module in the composition root + contracts + i18n catalogs (MODULE_GUIDE.md
// §4 Steps 1 & 8). Adding a module must require ZERO changes under core/.

import { validateKey, writeFile, log, logError } from './helpers.mjs';
import { backendFiles } from './templates.mjs';
import { webPageFile, featuresFile } from './frontend.mjs';
import { register } from './register.mjs';

function main() {
  const key = process.argv[2];
  try {
    validateKey(key);
  } catch (err) {
    logError(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  log(`Scaffolding module "${key}"...`);

  const files = [...backendFiles(key), webPageFile(key), featuresFile(key)];

  let created = 0;
  let skipped = 0;
  for (const [path, content] of files) {
    const result = writeFile(path, content);
    if (result.status === 'created') {
      created += 1;
    } else {
      skipped += 1;
      log(`  [skip] ${path} already exists`);
    }
  }
  log(`Scaffolded ${created} file(s)${skipped > 0 ? ` (${skipped} existing file(s) left untouched)` : ''}.`);

  register(key);

  log('');
  log(`Done. Next steps (MODULE_GUIDE.md §4):`);
  log(`  1. Replace the scaffold entity/use case with the module's real domain.`);
  log(`  2. Write db/migrations/0001_init.sql + 0002_rls.sql for the module's tables.`);
  log(`  3. Translate modules.${key}.* i18n keys in all four locale catalogs.`);
  log(`  4. Add the module to the README module table.`);
}

main();
