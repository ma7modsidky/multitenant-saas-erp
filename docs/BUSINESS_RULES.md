# ModuBiz — Business Rules

**Status:** Locked. Version 1.0.

This document is **the law**. Every rule here is an invariant that must be
enforced in the domain layer and covered by at least one automated test. A rule
that exists only in code is undiscoverable; a rule that exists only here is
unenforced. Both must be true.

**Rule ID format:** `<AREA>-<n>`. Reference the ID in test names, e.g.
`it('POS-12: rejects closing a shift with unsettled sales')`.

---

## 1. Tenancy rules

| ID    | Rule                                                                                                                                                                                                                                       | Enforced by                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| TEN-1 | Every tenant-owned row belongs to exactly one organization and can never be read, written, or deleted from another organization's context.                                                                                                 | RLS policy + isolation tests    |
| TEN-2 | `organization_id` is derived from the authenticated session, **never** from request input. A client-supplied `organizationId` in a body or query is ignored, and on a mutating route it is rejected with `400 UNEXPECTED_ORGANIZATION_ID`. | Tenant context + DTO validation |
| TEN-3 | A database operation executed without tenant context returns zero rows and fails writes. It must never fall back to "all tenants".                                                                                                         | RLS fail-closed predicate       |
| TEN-4 | A user may belong to multiple organizations. Exactly one organization is active per access token. Switching organizations issues new tokens; the old access token remains scoped to the old org until it expires.                          | Auth service                    |
| TEN-5 | Cross-tenant reads exist only for internal platform administration, through a separately audited code path and a distinct database role. Never through tenant-facing endpoints.                                                            | Role separation                 |
| TEN-6 | Background jobs and event handlers must re-establish tenant context from an explicit `organizationId` in the payload before any database access.                                                                                           | Job base class                  |
| TEN-7 | Cache, queue, and storage keys are namespaced by organization. Unnamespaced tenant data in a shared store is a security defect.                                                                                                            | Cache/storage services          |

---

## 2. Identity, authentication, and session rules

| ID      | Rule                                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-1  | Email addresses are unique globally, compared case-insensitively (`citext`), and stored normalized (trimmed, lowercased).                                                                                  |
| AUTH-2  | Passwords: minimum 12 characters, checked against a common-password deny list, hashed with **argon2id**. Password hashes are never logged, returned, or included in exports.                               |
| AUTH-3  | A new account must verify its email before it can create an organization. Accepting an invitation implicitly verifies the address.                                                                         |
| AUTH-4  | Access tokens expire in 15 minutes. Refresh tokens expire in 30 days and are **single-use with rotation** — presenting a used refresh token revokes the entire session family and raises a security event. |
| AUTH-5  | Only a hash of the refresh token is stored. Sessions record device and IP, are listable by the user, and are individually revocable.                                                                       |
| AUTH-6  | Changing a password, disabling 2FA, or an admin removing a member revokes all of that user's sessions for the affected scope immediately.                                                                  |
| AUTH-7  | Login is rate-limited per email and per IP with progressive backoff. After 10 consecutive failures the account is temporarily locked and the user is notified.                                             |
| AUTH-8  | Authentication failures always return the same generic `AUTH_INVALID_CREDENTIALS` code — never reveal whether the email exists.                                                                            |
| AUTH-9  | Password-reset and invitation tokens are single-use, expire (60 minutes for reset, 7 days for invitations), and are stored hashed.                                                                         |
| AUTH-10 | The user who creates an organization becomes its `OWNER`.                                                                                                                                                  |

---

## 3. Authorization and membership rules

### Role matrix

| Permission area                                                    | OWNER | ADMIN | MANAGER | MEMBER | VIEWER |
| ------------------------------------------------------------------ | ----- | ----- | ------- | ------ | ------ |
| Delete organization                                                | ✅    | ❌    | ❌      | ❌     | ❌     |
| Transfer ownership                                                 | ✅    | ❌    | ❌      | ❌     | ❌     |
| Manage billing / enable & disable modules                          | ✅    | ✅    | ❌      | ❌     | ❌     |
| Invite / remove members, assign roles                              | ✅    | ✅    | ❌      | ❌     | ❌     |
| Manage custom roles                                                | ✅    | ✅    | ❌      | ❌     | ❌     |
| Organization profile & settings (name, locale, currency, timezone) | ✅    | ✅    | ❌      | ❌     | ❌     |
| View audit log                                                     | ✅    | ✅    | ❌      | ❌     | ❌     |
| Module configuration (warehouses, registers, pipelines)            | ✅    | ✅    | ✅      | ❌     | ❌     |
| Module data write                                                  | ✅    | ✅    | ✅      | ✅     | ❌     |
| Module data read                                                   | ✅    | ✅    | ✅      | ✅     | ✅     |
| Export data                                                        | ✅    | ✅    | ✅      | ❌     | ❌     |

| ID      | Rule                                                                                                                                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTHZ-1 | An organization always has **at least one active OWNER**. The last owner cannot be removed, demoted, or have their membership suspended.                                                                                                                                                                                                      |
| AUTHZ-2 | Ownership transfer is explicit: the current owner nominates an existing active member, who is promoted, and only then may the former owner step down. Ownership is **OWNER-managed**: only a member holding the OWNER role may change or remove another OWNER — an ADMIN can never demote or remove an OWNER, even when another owner exists. |
| AUTHZ-3 | A user cannot change their own role, and cannot grant a permission they do not themselves hold.                                                                                                                                                                                                                                               |
| AUTHZ-4 | Custom roles may only combine permissions from registered modules and may never include platform-administration permissions reserved to OWNER/ADMIN.                                                                                                                                                                                          |
| AUTHZ-5 | Permission checks are declarative (`@RequiresPermission`). Ad-hoc role comparisons in service code (`if (user.role === 'ADMIN')`) are forbidden.                                                                                                                                                                                              |
| AUTHZ-6 | Entitlement is checked **before** permission. An unentitled module returns `403 MODULE_NOT_ENTITLED` even for an OWNER.                                                                                                                                                                                                                       |
| AUTHZ-7 | Removing a member soft-deletes the membership and reassigns or explicitly orphans their owned records (deals, activities) according to the module's documented policy — records are never silently deleted.                                                                                                                                   |
| AUTHZ-8 | A pending invitation for an email that already has an active membership is rejected with `MEMBERSHIP_ALREADY_EXISTS`.                                                                                                                                                                                                                         |
| AUTHZ-9 | Seat-limited plans reject an invitation that would exceed the paid seat count with `SEAT_LIMIT_EXCEEDED`, offering an upgrade path.                                                                                                                                                                                                           |

---

## 4. Subscription, trial, and entitlement rules

| ID      | Rule                                                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BILL-1  | An organization has exactly one Stripe customer and one base subscription. Each enabled module is a subscription **item** on it.                                                                                                                                                                                      |
| BILL-2  | Each module may be trialled **once per organization**, for 14 days, without a payment method. A second trial of the same module is rejected with `TRIAL_ALREADY_USED`.                                                                                                                                                |
| BILL-3  | Trial expiry moves the module to `expired`: **read-only** access for a 7-day grace period, then `disabled`. Data is retained throughout.                                                                                                                                                                              |
| BILL-4  | `core_module_entitlements` is the runtime authority for access. Stripe is the commercial authority. A nightly reconciliation job compares them and alerts on any drift; Stripe wins in a conflict. A module locally `active` but absent from the Stripe subscription is treated as cancelled and moved to `disabled`. |
| BILL-5  | Stripe webhooks are verified by signature, processed **idempotently** by event id, and safe to replay. Out-of-order events are resolved by comparing Stripe object versions. `customer.subscription.deleted` moves `active`/`trialing`/`expired` modules to `disabled` and `past_due` modules to `suspended`.         |
| BILL-6  | Payment failure moves the module to `past_due` with full access for a 7-day dunning window, then `suspended`.                                                                                                                                                                                                         |
| BILL-7  | Disabling a module immediately removes API and UI access and sets `purge_after = now() + dataRetentionDays` (descriptor). Re-enabling before that date restores full access to the existing data.                                                                                                                     |
| BILL-8  | Enabling a module whose `dependsOn` are not all entitled is rejected with `MODULE_DEPENDENCY_MISSING`.                                                                                                                                                                                                                |
| BILL-9  | Disabling a module that another entitled module depends on is rejected with `MODULE_DEPENDENCY_CONFLICT` (e.g. Inventory cannot be disabled while POS is active).                                                                                                                                                     |
| BILL-10 | Prices and amounts are never hardcoded. Code references `stripePriceKey`; amounts are resolved from Stripe at runtime and cached.                                                                                                                                                                                     |
| BILL-11 | The organization's billing currency is set at first subscription and is immutable thereafter (a Stripe constraint we surface explicitly). It is independent of the operational base currency.                                                                                                                         |
| BILL-12 | Downgrades and cancellations take effect at the end of the current period; upgrades take effect immediately with proration.                                                                                                                                                                                           |
| BILL-13 | Every entitlement state transition writes an audit entry with the actor (user, Stripe webhook, or system job).                                                                                                                                                                                                        |

---

## 5. Localization rules

| ID     | Rule                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I18N-1 | Locale resolution order: explicit request parameter → authenticated user preference → organization default → `Accept-Language` → `en`.                                       |
| I18N-2 | The API never returns prose intended for end users. Errors are `{ code, params }`; the client renders the message.                                                           |
| I18N-3 | A user-facing string literal in application code (backend templates or frontend JSX) is a defect. All copy comes from i18n catalogs.                                         |
| I18N-4 | A new locale must be complete for all platform keys before release. Missing keys fall back to `en` at runtime, but CI fails on missing keys in a supported locale.           |
| I18N-5 | Translatable tenant content must contain the organization's default locale key; other locales are optional and fall back to it.                                              |
| I18N-6 | The UI must render correctly in RTL. Only logical CSS properties are permitted; `ml-*`, `mr-*`, `left-*`, `right-*` and their CSS equivalents are lint errors.               |
| I18N-7 | Dates, times, numbers, and currencies are formatted exclusively through the shared formatters, using the active locale and the organization timezone.                        |
| I18N-8 | Customer-facing documents (receipts, invoices, order emails) render in the **customer's** locale when known, otherwise the organization default — not the operator's locale. |
| I18N-9 | Pluralization and gendered forms use ICU message syntax. String concatenation to build sentences is forbidden.                                                               |

---

## 6. Currency and money rules

| ID     | Rule                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CUR-1  | An organization has exactly one base currency, chosen at onboarding, **immutable** once any monetary record exists. Attempting to change it returns `BASE_CURRENCY_IMMUTABLE`.                                                                                                        |
| CUR-2  | Money is stored as integer minor units plus an ISO 4217 code. Floating-point money anywhere in the system is a defect.                                                                                                                                                                |
| CUR-3  | Arithmetic on money is performed only through `@modubiz/money`.                                                                                                                                                                                                                       |
| CUR-4  | Adding, subtracting, or comparing amounts in different currencies throws `CURRENCY_MISMATCH`. Conversion must be explicit and intentional.                                                                                                                                            |
| CUR-5  | Any record stored in a non-base currency also stores the exchange rate used, the base-currency equivalent, and the rate date. Historical values never change when rates change.                                                                                                       |
| CUR-6  | FX rates come from `core_fx_rates` daily snapshots. If no rate exists for the required date, the most recent prior snapshot is used and the record notes the actual `fx_rate_date`. If none exists at all, the operation fails with `FX_RATE_UNAVAILABLE` — never assume a rate of 1. |
| CUR-7  | Rounding uses the currency exponent from `core_currencies`, half-up, applied once at the boundary. Intermediate arithmetic retains full precision.                                                                                                                                    |
| CUR-8  | Document totals equal the sum of their rounded line totals. Discount allocation across lines uses remainder-safe allocation so no minor unit is created or lost.                                                                                                                      |
| CUR-9  | Money crosses the API as `{ amountMinor: string, currency: string }`. It is never serialized as a JS number.                                                                                                                                                                          |
| CUR-10 | Reports aggregating multiple currencies always present the base-currency total computed from stored snapshot rates, and disclose that conversion occurred.                                                                                                                            |

---

## 7. POS rules

### Registers and shifts

| ID    | Rule                                                                                                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POS-1 | A register is bound to exactly one warehouse. All stock movements from its sales affect that warehouse.                                                                                                                                             |
| POS-2 | At most one shift per register may be `open` at any time (enforced by a partial unique index).                                                                                                                                                      |
| POS-3 | A sale requires an open shift on the register. Selling without an open shift returns `POS_NO_OPEN_SHIFT`.                                                                                                                                           |
| POS-4 | Opening a shift records the opening cash float and the operator.                                                                                                                                                                                    |
| POS-5 | Closing a shift records counted cash, computes expected cash (`opening float + cash sales − cash refunds`), stores the variance, and locks the shift.                                                                                               |
| POS-6 | A closed shift is immutable. No sale may be added to, removed from, or edited within it. Post-close corrections are refunds in a later shift.                                                                                                       |
| POS-7 | A shift cannot be closed while unsynced offline sales for that register remain in the client outbox; the client must flush first, or an operator with MANAGER permission must force-close, which records `forced_close = true` and raises an alert. |
| POS-8 | Shift reports are computed in the organization's timezone.                                                                                                                                                                                          |

### Sales and payments

| ID     | Rule                                                                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POS-9  | Receipt numbers are sequential and gap-free per register, allocated atomically. A failed sale does not consume a number.                                                                             |
| POS-10 | A sale is completed only when the sum of its payments equals its total. Overpayment is represented as cash tendered with change due, never as an inflated payment amount.                            |
| POS-11 | All lines and payments of one sale share a single currency, matching the register's configured currency. Mixed-currency payment within one sale is out of scope for MVP and is rejected.             |
| POS-12 | Sale lines store snapshots of SKU, name, unit price, tax rate, and discount, so any historical receipt is exactly reproducible after product changes.                                                |
| POS-13 | A completed sale is immutable. Corrections are refunds or voids, never edits.                                                                                                                        |
| POS-14 | A sale may be **voided** only within the same open shift and only if no payment has been captured; afterwards, only a refund is possible.                                                            |
| POS-15 | Stock deduction happens in the same transaction as sale creation, via `InventoryStockPort`. If the stock operation fails, the entire sale fails — a sale is never recorded without its stock effect. |
| POS-16 | Discounts cannot make a line total or the sale total negative. Line discount ≤ line subtotal; order discount ≤ sum of line totals.                                                                   |
| POS-17 | Tax is calculated per line using the line's tax rate in basis points and is stored on the line; the sale's tax total is the sum of line taxes.                                                       |
| POS-18 | Linking a sale to a CRM contact is optional and stores the contact id without a foreign key. If CRM is not entitled, the field is simply unavailable.                                                |
| POS-19 | Every sale carries the locale used, so its receipt can be regenerated identically later.                                                                                                             |

### Refunds

| ID     | Rule                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POS-20 | A refund must reference an existing completed sale in the same organization.                                                                                                                                                           |
| POS-21 | Cumulative refunded quantity per line can never exceed the originally sold quantity; cumulative refunded amount can never exceed the sale total.                                                                                       |
| POS-22 | Restocking is decided **per refund line**. Restocked lines create a `return` stock movement; non-restocked lines (damaged goods) create a `write_off` movement. Either way a movement is recorded — stock is never silently unchanged. |
| POS-23 | A refund requires an open shift and a reason code.                                                                                                                                                                                     |
| POS-24 | Refunding more than the cash available in the drawer is permitted but flagged in the shift variance report.                                                                                                                            |

### Offline operation

| ID     | Rule                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POS-25 | The POS client must complete sales while offline, queueing them in a local durable outbox.                                                                                                                                                                                     |
| POS-26 | Every offline sale carries a client-generated `idempotency_key` (UUID). The server enforces `UNIQUE (organization_id, idempotency_key)`; a replay returns the original sale with `200`, never a duplicate.                                                                     |
| POS-27 | Receipt numbers for offline sales are provisional and client-scoped until sync; the server assigns the authoritative number, and the client reconciles and reprints if it differs.                                                                                             |
| POS-28 | Offline sales sync in `sold_at` order per device. Stock effects are applied at sync time and may drive stock negative; this is recorded as an `oversold` condition and surfaced as an alert rather than rejected — refusing a completed physical sale would corrupt the books. |
| POS-29 | Every sync attempt is recorded in `pos_sync_log` with its outcome, whether accepted, duplicate, or rejected.                                                                                                                                                                   |
| POS-30 | Offline sales unsynced for more than 24 hours trigger an operational alert to the organization's admins.                                                                                                                                                                       |
| POS-31 | The offline client caches only the product, price, and tax data required to sell, scoped to its own organization and register. Cached tenant data is cleared on logout or organization switch.                                                                                 |

---

## 8. Inventory rules

| ID     | Rule                                                                                                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-1  | `inv_stock_movements` is the single source of truth for stock. It is **append-only**: no updates, no deletes.                                                                                                                                              |
| INV-2  | `inv_stock_levels` is a derived projection and must always equal the sum of movements for its `(variant, warehouse)` pair. A nightly reconciliation asserts this and alerts on drift.                                                                      |
| INV-3  | Every movement has a non-zero signed quantity, a type, and a reference to what caused it (`reference_type` + `reference_id`).                                                                                                                              |
| INV-4  | Manual adjustments require a reason code. Adjustments without one are rejected with `ADJUSTMENT_REQUIRES_REASON`.                                                                                                                                          |
| INV-5  | Available quantity = `quantity_on_hand − quantity_reserved`. Sales and reservations validate against **available**, never on-hand.                                                                                                                         |
| INV-6  | Stock may go negative only through a documented path: a synced offline POS sale (POS-28) or an explicit override by a user holding `inventory:stock:adjust`. Both raise an `oversold` alert. Ordinary online sales are rejected with `INSUFFICIENT_STOCK`. |
| INV-7  | A reservation holds quantity for a bounded time (default 15 minutes) and expires automatically. Expired reservations are released by a job.                                                                                                                |
| INV-8  | Reservations transition `held → committed` (stock deducted) or `held → released` / `expired` (stock returned to available). No other transition is legal.                                                                                                  |
| INV-9  | A transfer between warehouses is two movements — `transfer_out` and `transfer_in` — created in a single transaction. A partial transfer is never persisted.                                                                                                |
| INV-10 | SKU and barcode are unique per organization among non-deleted variants.                                                                                                                                                                                    |
| INV-11 | A product variant with any stock movement history cannot be hard-deleted, only archived (`is_active = false`, then soft delete). Its historical movements remain.                                                                                          |
| INV-12 | Product cost uses moving-average valuation, recalculated on each `receipt` movement. Cost is never recalculated retroactively for past movements.                                                                                                          |
| INV-13 | A low-stock alert fires when available quantity crosses **below** the reorder point, and does not re-fire until it has recovered above it — no alert storms.                                                                                               |
| INV-14 | A stock count in `draft` may be edited; once `applied` it is immutable and generates `count_correction` movements for every variance.                                                                                                                      |
| INV-15 | Stock quantities use `numeric(18,4)`, supporting fractional units of measure. Comparisons use the UoM precision, never floating-point equality.                                                                                                            |
| INV-16 | Movements carry an optional `idempotency_key`, unique per organization, so retried operations (especially POS sync) cannot double-count.                                                                                                                   |

---

## 9. CRM rules

| ID     | Rule                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CRM-1  | A contact requires at least one of email or phone.                                                                                                                                                                                                     |
| CRM-2  | Contact email is unique per organization among non-deleted contacts. A duplicate is rejected with `CRM_CONTACT_DUPLICATE_EMAIL`, offering merge.                                                                                                       |
| CRM-3  | Every organization has exactly one default pipeline. It cannot be deleted while it is the default.                                                                                                                                                     |
| CRM-4  | A pipeline has at least one stage, exactly one `is_won` stage, and exactly one `is_lost` stage.                                                                                                                                                        |
| CRM-5  | Stage positions are contiguous and unique within a pipeline; reordering rewrites positions atomically.                                                                                                                                                 |
| CRM-6  | Every deal stage change appends a row to `crm_deal_stage_history` with the elapsed duration in the previous stage. History is append-only.                                                                                                             |
| CRM-7  | Moving a deal to a lost stage requires a `lost_reason_code`.                                                                                                                                                                                           |
| CRM-8  | A deal's value carries its own currency, which may differ from the base currency; the FX snapshot rule (CUR-5) applies. Pipeline totals are reported in the base currency.                                                                             |
| CRM-9  | Closing a deal (won or lost) sets `closed_at` and `status`. A closed deal may be reopened only by a user with `crm:deal:write`, which appends a history entry — timestamps are never cleared silently.                                                 |
| CRM-10 | A deal must reference a contact or a company (at least one).                                                                                                                                                                                           |
| CRM-11 | Deleting a contact soft-deletes it and detaches it from open deals; it does not delete the deals.                                                                                                                                                      |
| CRM-12 | Merging two contacts moves all activities, notes, deals, and attachments to the surviving record, soft-deletes the other, and writes an audit entry recording both ids. Merges are not automatically reversible; the audit entry is the recovery path. |
| CRM-13 | Completing an activity sets `completed_at`; a completed activity cannot be edited except to append notes.                                                                                                                                              |
| CRM-14 | Activity assignment is limited to active members of the same organization.                                                                                                                                                                             |

---

## 10. Audit, notification, and data-governance rules

| ID      | Rule                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-1   | Every create, update, delete, permission change, entitlement change, login, and export writes an audit entry with actor, action, entity type and id, before/after snapshot, IP, and correlation id. |
| AUD-2   | The audit log is append-only and immutable. There is no update or delete path, for any role.                                                                                                        |
| AUD-3   | Audit entries never contain secrets, password hashes, tokens, or full payment credentials. Sensitive fields are redacted before persistence.                                                        |
| AUD-4   | Audit entries are retained for at least 12 months and remain readable while the organization exists.                                                                                                |
| NOTIF-1 | Notification delivery is best-effort and asynchronous. A failed notification never fails the originating business operation.                                                                        |
| NOTIF-2 | Notifications respect the recipient's locale and per-type preferences. Transactional security messages (password change, new device login) cannot be opted out of.                                  |
| NOTIF-3 | Notification sending is idempotent per `(type, entity, recipient)` to survive job retries.                                                                                                          |
| GDPR-1  | An organization may export all of its data at any time in a machine-readable format; every module contributes its own export routine.                                                               |
| GDPR-2  | Deleting an organization begins a 30-day `pending_deletion` grace period during which OWNER can cancel; afterwards all tenant rows are hard-deleted across all module prefixes.                     |
| GDPR-3  | An erasure request for an individual pseudonymizes personal fields in place while preserving financial and audit records under a stable pseudonym.                                                  |
| GDPR-4  | Every export and erasure request is itself audited and its download link expires within 7 days.                                                                                                     |

---

## 11. Cross-cutting operational rules

| ID    | Rule                                                                                                                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-1 | All mutating endpoints that a client may retry (checkout, payments, imports, sync) accept an `Idempotency-Key` header and guarantee at-most-once effect.             |
| OPS-2 | Event handlers are idempotent and must tolerate duplicate delivery.                                                                                                  |
| OPS-3 | A failed event handler must never roll back or fail the publishing request. Failures are retried with backoff and land in a dead-letter queue after exhaustion.      |
| OPS-4 | Long-running work (exports, imports, backfills, bulk operations) runs as a background job with progress, cancellation, and resumability — never inline in a request. |
| OPS-5 | External calls (Stripe, email, FX, storage) have explicit timeouts and retry policies and are never made while holding a database transaction open.                  |
| OPS-6 | Rate limits apply per organization and per user; POS sync endpoints have a dedicated, higher limit tuned for burst reconnection.                                     |
| OPS-7 | Any operation that could affect more than 1,000 rows requires explicit confirmation from the client and runs as a job.                                               |
| OPS-8 | Feature-flag and entitlement checks are always server-authoritative. Client-side gating is UX only, never security.                                                  |

---

## 12. Rule-to-test traceability

Every rule in this document must be traceable to a test.

- Test names include the rule id:
  `it('INV-6: rejects an online sale exceeding available stock', ...)`.
- A CI report lists rule ids with no matching test and fails the build if a rule
  marked **critical** (all of TEN-_, AUTH-_, CUR-*, BILL-4, INV-1, INV-2,
  POS-26) is uncovered.
- Adding a rule here without a test in the same PR is not allowed.
- Changing behaviour that contradicts a rule requires updating this document
  **in the same PR** as the code.

---

## 13. Related documents

[PRD.md](./PRD.md) · [TECH_STACK.md](./TECH_STACK.md) ·
[ARCHITECTURE.md](./ARCHITECTURE.md) · [MODULE_GUIDE.md](./MODULE_GUIDE.md) ·
[DATA_MODEL.md](./DATA_MODEL.md) · [CODING_STANDARDS.md](./CODING_STANDARDS.md)
· [TESTING.md](./TESTING.md)
