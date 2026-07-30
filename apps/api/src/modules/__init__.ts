// apps/api/src/modules/
// Business modules — bounded contexts.
// Each module is a small hexagonal application.
// Modules may import core/ and @modubiz/contracts.
// Modules must NOT import from other modules or platform/.
//
// Modules (will be populated in Phase 4-6):
//   crm/        — Contacts, companies, deals, pipeline
//   inventory/  — Products, stock levels, reservations, movements
//   pos/        — Point of sale, shifts, sales, refunds, offline sync
