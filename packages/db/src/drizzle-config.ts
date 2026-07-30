import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * Drizzle configuration for the modubiz_app role.
 *
 * The app connects as the non-owner `modubiz_app` role so that
 * Row-Level Security is genuinely enforced at the database level.
 *
 * @see DATA_MODEL.md §1 — Database roles
 */
export function createDbClient(connectionString: string, poolMax = 10): PostgresJsDatabase {
  const client = postgres(connectionString, {
    max: poolMax,
    prepare: false, // Use unnamed prepared statements for connection pooling compatibility
  });

  return drizzle(client, { logger: false });
}

/**
 * Creates a migration client as the owner role.
 * Only used by the migration runner.
 */
export function createMigrationClient(connectionString: string): postgres.Sql {
  return postgres(connectionString, {
    max: 1,
    onnotice: () => {}, // Suppress NOTICE messages during migrations
  });
}
