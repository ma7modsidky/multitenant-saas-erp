import { ConfigService } from '@modubiz/config';
import { createDbClient } from '@modubiz/db';
import { type Provider } from '@nestjs/common';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Drizzle database injection token.
 * Use this token when injecting the Drizzle client into services/repositories.
 */
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

/**
 * Drizzle database type.
 * The type of the Drizzle ORM client instance.
 */
export type DrizzleDb = PostgresJsDatabase;

/**
 * DrizzleProvider — NestJS provider for the Drizzle ORM client.
 *
 * Creates a connection pool as the non-owner `modubiz_app` role,
 * so that Row-Level Security is genuinely enforced at the database level.
 *
 * Pool configuration:
 *   - max connections: configurable via DATABASE_POOL_MAX env var
 *   - unnamed prepared statements: for PgBouncer compatibility
 *
 * @see DATA_MODEL.md §1 — Database roles
 * @see DATA_MODEL.md §1 — modubiz_app role
 */
export const DrizzleProvider: Provider<DrizzleDb> = {
  provide: DRIZZLE_DB,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DrizzleDb => {
    return createDbClient(config.databaseUrl, config.databasePoolMax);
  },
};
