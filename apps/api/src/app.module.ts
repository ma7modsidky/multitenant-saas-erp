import { Module } from '@nestjs/common';

/**
 * AppModule — the composition root of the modular monolith.
 *
 * This is one of only two files permitted to import module public barrels.
 * It composes:
 *   - core/   (shared kernel: tenancy, auth, database, events, etc.)
 *   - platform/ (tenant-facing capabilities: orgs, users, billing, etc.)
 *   - modules/  (business modules: crm, inventory, pos)
 *
 * @see ARCHITECTURE.md §3 — The composition root exception
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
