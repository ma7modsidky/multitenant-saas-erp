// apps/api/src/core/
// Shared kernel — stable, module-agnostic infrastructure.
// Every module may import from core/.
// core/ must never import from platform/ or modules/.
//
// Directories (will be populated in Phase 1):
//   auth/          — Passport strategies, token service, password hashing
//   tenancy/       — TenantContext (AsyncLocalStorage), middleware
//   authorization/ — CASL ability factory, guards
//   entitlements/  — EntitlementService + guard
//   database/      — Drizzle provider, TransactionManager, repository base
//   events/        — EventBus, outbox, typed listener decorator
//   jobs/           — BullMQ queue registration + base processor
//   cache/          — tenant-namespaced cache via Redis
//   audit/          — AuditLogger + interceptor
//   notifications/  — in-app + email dispatch ports
//   storage/        — R2 presigned upload/download
//   i18n/           — request locale resolution, template rendering
//   observability/  — logger, tracing, metrics, correlation id
//   common/         — Error model, base DTOs, interceptors, pipes
