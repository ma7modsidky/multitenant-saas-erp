import { Global, Module } from '@nestjs/common';

import { DrizzleProvider } from './drizzle.provider.js';
import { TransactionManager } from './transaction-manager.js';
import { UnitOfWork } from './unit-of-work.js';

/**
 * DatabaseModule — the shared database infrastructure module.
 *
 * Provides:
 *   - Drizzle ORM client (connection pool as modubiz_app role)
 *   - TransactionManager (RLS binding + transaction management)
 *   - UnitOfWork (event collection + after-commit publishing)
 *
 * This module is marked @Global so that any module in the application
 * can inject the TransactionManager and UnitOfWork without importing
 * DatabaseModule explicitly.
 *
 * @see DATA_MODEL.md §1 — Database roles
 * @see DATA_MODEL.md §2 — RLS and per-request binding
 * @see ARCHITECTURE.md §3 — core/database
 */
@Global()
@Module({
  providers: [DrizzleProvider, TransactionManager, UnitOfWork],
  exports: [DrizzleProvider, TransactionManager, UnitOfWork],
})
export class DatabaseModule {}
