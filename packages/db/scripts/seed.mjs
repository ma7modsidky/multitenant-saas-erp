// Seed CLI (plain JS so it can read process.env — see AGENTS.md rule 9).
// Usage: node --env-file=../../.env scripts/seed.mjs
import { seedDatabase } from '../dist/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL is not set (expected in .env)');
  process.exit(1);
}

await seedDatabase(connectionString);
