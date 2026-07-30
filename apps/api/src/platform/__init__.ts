// apps/api/src/platform/
// Tenant-facing platform capabilities.
// May import core/ and @modubiz/contracts.
// Must NOT import modules/ or platform/ from other packages.
//
// Directories (will be populated in Phase 2):
//   organizations/  — Org CRUD, soft delete, settings
//   users/          — Signup, login, password reset, session management
//   memberships/    — Multi-org membership, org switching
//   invitations/     — Invite by email, accept/decline/resend
//   roles/          — System + custom roles, RBAC
//   billing/        — Stripe adapter, webhooks, subscription sync
//   module-registry/ — Descriptor collection, enable/disable, trial orchestration
//   audit-log/      — Read API over core/audit storage
//   search/         — Federated search aggregator
//   fx-rates/       — Daily rate snapshots
