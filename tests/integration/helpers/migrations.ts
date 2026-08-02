/**
 * Shared migration helper for integration suites.
 *
 * Applies the platform core migrations followed by every module-owned
 * migration directory (namespaced per module), exactly like `pnpm db:migrate`.
 * Integration tests previously hardcoded `MIGRATIONS_DIR` and called
 * `runMigrations` for core only — swap those calls for `applyAllMigrations`
 * so suites exercise the real module-aware runner (PLAN.md Step 4.0.1).
 */
import { runAllMigrations } from '../../../packages/db/src/migrate.js';

/** Apply core + module migrations as the owner role. */
export async function applyAllMigrations(connectionString: string): Promise<void> {
  await runAllMigrations(connectionString);
}
