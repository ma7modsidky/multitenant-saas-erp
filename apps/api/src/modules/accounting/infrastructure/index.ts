// Infrastructure layer for the accounting module.
// Drizzle repositories + external adapters live here (MODULE_GUIDE.md §4).

export { DrizzleAccountingRepository } from './repositories/drizzle-accounting.repository.js';
export { TaxRateReadPortImpl } from './ports/tax-rate-read.port.impl.js';
