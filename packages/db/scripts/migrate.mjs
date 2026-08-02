// Migration runner CLI (plain JS so it can read process.env — see AGENTS.md rule 9).
// Usage: node --env-file=../../.env scripts/migrate.mjs
import { runAllMigrations } from '../dist/index.js';

const connectionString = process.env.DATABASE_MIGRATION_URL;
if (!connectionString) {
  console.error('❌ DATABASE_MIGRATION_URL is not set (expected in .env)');
  process.exit(1);
}

// Applies core migrations + every discovered module migration dir
// (apps/api/src/modules/<key>/db/migrations/), namespaced per module.
await runAllMigrations(connectionString);
