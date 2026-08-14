# ModuBiz — Data Model

**Status:** Locked. Version 1.0. Persistence: PostgreSQL 16+ with Row-Level
Security · Drizzle ORM · module-owned migrations.

---

## 1. Tenancy model

**Single database, single schema, shared tables, isolated by Row-Level
Security.**

| Decision                                         | Rationale                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Shared tables + RLS                              | Scales to 10k orgs without connection/schema explosion; one migration path; cross-tenant analytics remain possible via a privileged role |
| RLS rather than app-level filtering only         | Application bugs cannot leak data; defence in depth                                                                                      |
| App connects as a **non-owner** role             | Table owners bypass RLS in Postgres. The app role must never own tables                                                                  |
| `FORCE ROW LEVEL SECURITY` on every tenant table | Prevents accidental bypass                                                                                                               |
| Session variable set per transaction             | `SET LOCAL` is transaction-scoped, so a pooled connection cannot leak tenant context                                                     |

Rejected: schema-per-tenant (migration cost, connection overhead) and
database-per-tenant (operationally infeasible at this price point).

### Database roles

| Role                | Owns tables | RLS applies                        | Used by                                          |
| ------------------- | ----------- | ---------------------------------- | ------------------------------------------------ |
| `modubiz_owner`     | Yes         | Bypassed                           | Migration runner only (`DATABASE_MIGRATION_URL`) |
| `modubiz_app`       | No          | **Yes, forced**                    | The API at runtime (`DATABASE_URL`)              |
| `modubiz_analytics` | No          | Yes (read-only, all-tenant policy) | Reporting/BI, read replica                       |

```sql
CREATE ROLE modubiz_app LOGIN PASSWORD :'app_password' NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO modubiz_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO modubiz_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO modubiz_app;
```

---

## 2. The RLS pattern (copy this exactly)

Every tenant-owned table gets this block in the module's `NNNN_rls.sql`
migration. **No exceptions, no variations.**

```sql
-- Template: replace <table> only.
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON <table>
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
```

Notes:

- The `NULLIF(..., '')` wrapper is **mandatory, not optional**. PostgreSQL
  resets custom GUCs (`app.*`) to the **empty string** — not `NULL` — after any
  transaction that touches them via `set_config(..., true)`, even on a dedicated
  connection. A policy casting the raw value (`current_setting(...)::uuid`)
  therefore crashes with `invalid input syntax for type uuid: ""` on the next
  **org-less** query served by that pooled connection (e.g. the switch-org
  lookup right after a user creates their first organization) → HTTP 500.
- `NULLIF(current_setting(..., true), '')` normalizes both unset (`NULL`) and
  reset (`''`) to `NULL`, so the predicate is `NULL` → **no rows match** and the
  cast can never see an empty string. A query executed without tenant context
  silently sees nothing; it never sees everything. This fail-closed behaviour is
  intentional and is asserted by tests.
- The `user_own_memberships` policy (0007) follows the same rule for
  `app.current_user_id`.
- Fix forward: merged migration `0003_rls.sql` used the raw cast; it was
  hardened by `0008_nullif_rls_policies.sql`. Do not edit merged migrations.
- `WITH CHECK` blocks writing a row belonging to another org — insert and update
  are both covered.
- Global (non-tenant) tables — `core_currencies`, `core_fx_rates`,
  `core_module_catalog`, `core_users` — do **not** get this policy. They are
  enumerated in §4.1 and any addition to that list requires review.

### Per-request binding

`TransactionManager` in `core/database` is the only code allowed to set these
variables:

```typescript
await db.transaction(async (tx) => {
  await tx.execute(
    sql`SELECT set_config('app.current_organization_id', ${orgId}, true)`,
  );
  await tx.execute(
    sql`SELECT set_config('app.current_user_id', ${userId}, true)`,
  );
  return work(tx);
});
```

`set_config(..., true)` is transaction-local — safe with connection pooling
(including PgBouncer in transaction mode).

**Important:** a variable is left **unset** when the context has no value —
never bound to an empty string.
`set_config('app.current_organization_id', '', true)` would crash RLS policies
casting `::uuid` on the next org-less query served by that pooled connection
(see the `NULLIF` note above).

**Rules for all feature code:**

1. Every database access happens inside `TransactionManager.run()`.
2. No repository method takes `organizationId` as a filter argument.
3. `organization_id` on insert is populated by the repository base from
   `TenantContext`, never from client input.
4. Background jobs and event handlers must open tenant context explicitly from
   the job payload's `organizationId` before touching the database.

---

## 3. Universal column conventions

### Mandatory base columns — every tenant-owned table

| Column            | Type                                   | Notes                                                                                  |
| ----------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`              | `uuid` PK, default `gen_random_uuid()` | UUID v7 preferred when generated in the app for index locality                         |
| `organization_id` | `uuid NOT NULL`                        | FK → `core_organizations(id)`; RLS key; **first column of most composite indexes**     |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`   |                                                                                        |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`   | Maintained by trigger `set_updated_at()`                                               |
| `created_by`      | `uuid NULL`                            | FK → `core_users(id)`; null for system actions                                         |
| `updated_by`      | `uuid NULL`                            |                                                                                        |
| `deleted_at`      | `timestamptz NULL`                     | Soft delete. Required on user-facing business entities; omitted on append-only ledgers |

### Naming rules

| Thing            | Convention                                   | Example                                |
| ---------------- | -------------------------------------------- | -------------------------------------- |
| Table            | `<module_prefix>_<plural_snake>`             | `inv_stock_movements`                  |
| Table prefixes   | `core_` (platform), `crm_`, `inv_`, `pos_`   | one prefix per module, globally unique |
| Column           | `snake_case`                                 | `reorder_point`                        |
| FK column        | `<singular_referenced>_id`                   | `warehouse_id`                         |
| Index            | `idx_<table>_<cols>`                         | `idx_inv_products_org_sku`             |
| Unique index     | `uq_<table>_<cols>`                          | `uq_inv_products_org_sku`              |
| Check constraint | `ck_<table>_<rule>`                          | `ck_pos_sales_total_non_negative`      |
| Enum             | Postgres `enum` type named `<prefix>_<name>` | `pos_payment_method`                   |
| Money pair       | `<name>_amount_minor` + `<name>_currency`    | `total_amount_minor`, `total_currency` |
| Boolean          | `is_` / `has_` prefix                        | `is_active`                            |
| Timestamp        | `_at` suffix                                 | `closed_at`                            |

### Hard schema rules

1. **No foreign keys across module prefixes.** `pos_sales.customer_contact_id`
   references a CRM contact **by id with no FK constraint**; validity is checked
   through a port. This is what keeps modules extractable.
2. Every FK within a module is explicit and indexed.
3. Uniqueness is always **scoped to the organization**:
   `UNIQUE (organization_id, sku)`, never `UNIQUE (sku)`.
4. Enumerations that the tenant can extend are tables, not Postgres enums. Fixed
   technical enumerations are Postgres enums.
5. Append-only ledgers (`inv_stock_movements`, `core_audit_log`,
   `core_platform_audit_log`, `pos_payments`) have **no** `UPDATE`/`DELETE`
   path. Corrections are new compensating rows. Enforced by a rule/trigger plus
   repository design.
6. `jsonb` is allowed for translations, flexible metadata, and event payloads —
   never for data that must be queried relationally or constrained.
7. Timestamps are always `timestamptz` stored in UTC. Display timezone comes
   from the organization.
8. **Raw
   `sql`` bindings of timestamps use `toDbDate`/`fromDbDate`** from `apps/api/src/core/database/db-date.ts`. Drizzle's postgres-js driver overrides postgres.js date serializers/parsers with identity functions, so a raw `Date`bound in a`sql``
   template crashes at runtime (`ERR_INVALID_ARG_TYPE`) and reads return
   timestamptz as strings. Always serialize writes with `toDbDate(...)` and
   normalize reads with `fromDbDate(...)` when using raw SQL templates (the
   drizzle query builder path is unaffected — it maps `Date` via the column
   type).

---

## 4. Core platform tables

### 4.1 Global (non-tenant) tables

| Table                     | Purpose                                                                                                                                                                                        | RLS                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `core_users`              | Identity: email, password hash, name, preferred locale, verification state, login lockout (`failed_login_attempts`, `locked_until`), platform-admin flag (`is_platform_admin`, migration 0013) | No (row visibility governed by membership queries) |
| `core_sessions`           | Refresh-token sessions: hash, device, ip, expiry, revocation                                                                                                                                   | No                                                 |
| `core_organizations`      | Tenants                                                                                                                                                                                        | No (visibility via membership)                     |
| `core_currencies`         | ISO 4217 reference: code, exponent, symbol                                                                                                                                                     | No (read-only reference)                           |
| `core_fx_rates`           | Daily rate snapshots: base, quote, rate, valid_on, source                                                                                                                                      | No (read-only reference)                           |
| `core_module_catalog`     | Registered modules, mirrored from descriptors at boot                                                                                                                                          | No (read-only reference)                           |
| `core_permissions`        | Permission catalog, mirrored from descriptors at boot                                                                                                                                          | No (read-only reference)                           |
| `core_module_pricing`     | Admin-editable module list prices (monthly/yearly minor units + currency) — display/planning data, never the commercial authority                                                              | No (admin-managed reference)                       |
| `core_saas_settings`      | Platform-level settings (key → jsonb value), allow-listed keys only                                                                                                                            | No (admin-managed reference)                       |
| `core_platform_audit_log` | Append-only trail of platform-admin actions (actor, action, entity, before/after) — the separately audited code path TEN-5 requires                                                            | No (global; written by admin use cases)            |

The last three are **platform-admin tables** (migration 0013): global, no RLS,
managed exclusively by the `/v1/admin/*` back-office. They never hold tenant
rows, so RLS is not applicable; the admin code path still binds every
tenant-table query to one organization via `runWithOrg` (PLT-3).
`core_platform_audit_log` follows the append-only discipline of `core_audit_log`
(AUD-2) but is platform-scoped.

The mirror is two-way at boot (`BootValidationService.validateAndSync`):
registered descriptors are upserted, and catalog rows for keys **no longer
registered** are pruned (permissions first, then the catalog row). A row still
referenced by a `core_module_entitlements` FK is kept — the FK (NO ACTION) is
what protects tenant entitlement rows from being orphaned; the app role cannot
pre-check entitlements from the boot context because they are RLS-protected.

### 4.2 Tenant-scoped platform tables (all RLS-protected)

| Table                        | Purpose                                                                  | Key columns                                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core_memberships`           | Links a user to an organization                                          | `user_id`, `organization_id`, `role_id`, `status`, `joined_at` — partial `uq_core_memberships_active` (`WHERE deleted_at IS NULL`): at most one **active** membership per (org, user); soft-deleted memberships do not block re-join (AUTHZ-7) |
| `core_roles`                 | System + custom roles                                                    | `key`, `name_i18n jsonb`, `is_system`, `UNIQUE (organization_id, key)`                                                                                                                                                                         |
| `core_role_permissions`      | Role → permission keys                                                   | `role_id`, `permission_key`                                                                                                                                                                                                                    |
| `core_invitations`           | Pending invites                                                          | `email`, `role_id`, `token_hash`, `expires_at`, `accepted_at`, `revoked_at`                                                                                                                                                                    |
| `core_subscriptions`         | Stripe subscription mirror                                               | `stripe_customer_id`, `stripe_subscription_id`, `status`, `billing_currency`, `current_period_end`                                                                                                                                             |
| `core_module_entitlements`   | **Runtime authority for module access**                                  | `module_key`, `state`, `trial_started_at`, `trial_ends_at`, `activated_at`, `disabled_at`, `purge_after`, `stripe_subscription_item_id` — `UNIQUE (organization_id, module_key)`                                                               |
| `core_audit_log`             | Append-only audit trail                                                  | `actor_user_id`, `actor_type`, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `ip`, `correlation_id`, `occurred_at`                                                                                                      |
| `core_notifications`         | In-app notifications                                                     | `user_id`, `type`, `payload jsonb`, `read_at`                                                                                                                                                                                                  |
| `core_outbox`                | Transactional outbox for durable events                                  | `event_name`, `payload jsonb`, `published_at`, `attempts`, `failed_reason`                                                                                                                                                                     |
| `core_data_exports`          | Export/erasure requests                                                  | `type`, `status`, `requested_by`, `file_key`, `expires_at`                                                                                                                                                                                     |
| `core_organization_settings` | Locale, timezone, base currency, number/date preferences, receipt footer | one row per org                                                                                                                                                                                                                                |

### 4.3 Organization identity columns

```
core_organizations
  id                 uuid pk
  name               text not null
  slug               citext not null unique
  country_code       char(2) not null
  timezone           text not null default 'UTC'
  base_currency      char(3) not null            -- IMMUTABLE once any monetary row exists
  default_locale     text not null default 'en'
  status             text not null               -- active | suspended | pending_deletion
  deletion_scheduled_at timestamptz null
  created_at / updated_at
```

### Entitlement states

`available` · `trialing` · `active` · `past_due` · `expired` · `suspended` ·
`disabled` — semantics and transition rules in
[PRD.md §6](./PRD.md#6-module-lifecycle) and
[BUSINESS_RULES.md §4](./BUSINESS_RULES.md#4-subscription-trial-and-entitlement-rules).

---

## 5. Money

### Storage

Every monetary value is **two columns**:

```
<name>_amount_minor   bigint NOT NULL     -- integer minor units (cents/fils/…)
<name>_currency       char(3) NOT NULL    -- ISO 4217, FK → core_currencies(code)
```

When the value may differ from the organization's base currency, the record
additionally stores the conversion **used at the time**:

```
exchange_rate         numeric(20,10) NULL  -- transaction currency → org base currency
base_amount_minor     bigint NULL          -- computed at write time with the above rate
fx_rate_date          date NULL            -- which core_fx_rates snapshot was used
```

### Rules

| #   | Rule                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Never `float`, `double`, `real`, or `numeric` for a monetary amount. `bigint` minor units only.                                                                               |
| M2  | Never a bare amount without its currency column.                                                                                                                              |
| M3  | All arithmetic goes through `@modubiz/money`. Raw arithmetic on `*_amount_minor` in application code is a defect.                                                             |
| M4  | Adding or comparing two `Money` values of different currencies **throws**. Conversion must be explicit.                                                                       |
| M5  | The FX rate is snapshotted onto the record at write time. Historical figures never change when rates change.                                                                  |
| M6  | Rounding uses the currency exponent from `core_currencies`, half-up, applied **once** at the presentation/persistence boundary. Intermediate arithmetic keeps full precision. |
| M7  | Line-level rounding is authoritative: a document total equals the sum of its rounded line totals, so displayed lines always add up.                                           |
| M8  | The org base currency is immutable once any monetary row exists for the org.                                                                                                  |

```typescript
// packages/money/src/money.ts (shape)
export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: CurrencyCode,
  ) {}
  static of(amountMinor: bigint | number, currency: CurrencyCode): Money;
  static zero(currency: CurrencyCode): Money;
  add(other: Money): Money; // throws CurrencyMismatchError
  subtract(other: Money): Money; // throws CurrencyMismatchError
  multiply(qty: Decimalish): Money; // full precision, rounds once at the end
  allocate(ratios: number[]): Money[]; // remainder-safe split, no lost units
  convertTo(currency: CurrencyCode, rate: FxRate): ConvertedMoney; // carries the rate
  isNegative(): boolean;
  toJSON(): { amountMinor: string; currency: CurrencyCode }; // string: JS number is unsafe > 2^53
}
```

`bigint` serializes as a **string** in JSON. The generated API client and
frontend must treat money amounts as strings and never as JS numbers.

---

## 6. Localization in the data model

### Translatable tenant content

Tenant-authored text that end customers see uses a `jsonb` map keyed by locale:

```
name_i18n   jsonb not null   -- {"en":"Espresso","ar":"إسبريسو","fr":"Expresso"}
```

Rules:

1. The organization's `default_locale` key **must** be present; other locales
   are optional.
2. Resolution order at read time: requested locale → org default locale → first
   available key.
3. Searchable translatable fields get a GIN index on the extracted text, or a
   generated column for the default locale:
   ```sql
   ALTER TABLE inv_products
     ADD COLUMN name_default text
     GENERATED ALWAYS AS (name_i18n ->> 'en') STORED;
   CREATE INDEX idx_inv_products_name_default ON inv_products (organization_id, name_default);
   ```
4. **Internal-only** text (reason codes, internal notes, technical labels) is
   plain `text`. Do not over-translate.
5. System text (validation messages, UI labels, email/receipt templates) is
   **never** in the database — it lives in `packages/i18n` catalogs.

### Locale and timezone

- `core_users.preferred_locale` (nullable) overrides
  `core_organizations.default_locale`.
- All timestamps are UTC `timestamptz`; rendering uses the org timezone unless
  the user overrides it.
- "Business day" boundaries (POS shift reports, daily sales) are computed in the
  **organization's** timezone, not UTC.

---

## 7. CRM schema (`crm_`)

| Table                       | Purpose                            | Notable columns                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm_companies`             | Organizations the tenant sells to  | `name`, `domain`, `industry`, `address jsonb`, `owner_user_id`                                                                                                                                                                                          |
| `crm_contacts`              | People                             | `first_name`, `last_name`, `email`, `phone`, `company_id`, `owner_user_id`, `preferred_locale`, `preferred_currency`                                                                                                                                    |
| `crm_pipelines`             | Deal pipelines                     | `name_i18n`, `is_default`                                                                                                                                                                                                                               |
| `crm_pipeline_stages`       | Ordered stages                     | `pipeline_id`, `name_i18n`, `position`, `probability`, `is_won`, `is_lost`                                                                                                                                                                              |
| `crm_deals`                 | Opportunities                      | `title`, `pipeline_id`, `stage_id`, `contact_id`, `company_id`, `value_amount_minor`, `value_currency`, `exchange_rate`, `base_amount_minor`, `expected_close_date`, `status` (`open`\|`won`\|`lost`), `closed_at`, `lost_reason_code`, `owner_user_id` |
| `crm_deal_stage_history`    | Append-only stage transitions      | `deal_id`, `from_stage_id`, `to_stage_id`, `moved_at`, `moved_by`, `duration_seconds`                                                                                                                                                                   |
| `crm_activities`            | Calls, meetings, tasks, email logs | `type`, `subject`, `due_at`, `completed_at`, `related_type`, `related_id`, `assigned_to`                                                                                                                                                                |
| `crm_notes`                 | Free-text notes                    | `body`, `related_type`, `related_id`                                                                                                                                                                                                                    |
| `crm_tags`, `crm_taggables` | Tagging                            | `name`, `color`                                                                                                                                                                                                                                         |
| `crm_attachments`           | File references                    | `storage_key`, `filename`, `mime_type`, `size_bytes`, `related_type`, `related_id`                                                                                                                                                                      |

Key indexes: `uq_crm_contacts_org_email` (partial,
`WHERE deleted_at IS NULL AND email IS NOT NULL`),
`idx_crm_deals_org_stage_status`, `idx_crm_activities_org_assigned_due`.

---

## 8. Inventory schema (`inv_`)

| Table                                       | Purpose                                        | Notable columns                                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inv_categories`                            | Product categories (nested)                    | `name_i18n`, `parent_id`                                                                                                                                                                                   |
| `inv_units_of_measure`                      | UoM                                            | `code`, `name_i18n`, `precision`                                                                                                                                                                           |
| `inv_products`                              | Product templates                              | `name_i18n`, `description_i18n`, `category_id`, `uom_id`, `is_active`, `tax_rate_bp`, `tracking_mode` (`none`\|`quantity`)                                                                                 |
| `inv_product_variants`                      | Sellable units                                 | `product_id`, `sku`, `barcode`, `attributes jsonb`, `price_amount_minor`, `price_currency`, `cost_amount_minor`, `cost_currency`, `reorder_point`, `reorder_quantity`, `is_active`                         |
| `inv_warehouses`                            | Locations                                      | `name`, `code`, `address jsonb`, `is_default`, `is_active`                                                                                                                                                 |
| `inv_stock_levels`                          | **Derived cache** of on-hand/reserved          | `variant_id`, `warehouse_id`, `quantity_on_hand numeric(18,4)`, `quantity_reserved numeric(18,4)`, `last_movement_id`, `UNIQUE (organization_id, variant_id, warehouse_id)`                                |
| `inv_stock_movements`                       | **Append-only ledger — the source of truth**   | `variant_id`, `warehouse_id`, `type`, `quantity numeric(18,4)` (signed), `unit_cost_amount_minor`, `unit_cost_currency`, `reference_type`, `reference_id`, `reason_code`, `idempotency_key`, `occurred_at` |
| `inv_stock_reservations`                    | Soft holds                                     | `variant_id`, `warehouse_id`, `quantity`, `state` (`held`\|`committed`\|`released`\|`expired`), `expires_at`, `reference_type`, `reference_id`                                                             |
| `inv_stock_counts`, `inv_stock_count_lines` | Physical counts                                | `status`, `counted_at`, `expected_quantity`, `counted_quantity`, `variance`                                                                                                                                |
| `inv_low_stock_alerts`                      | Alert state (to avoid duplicate notifications) | `variant_id`, `warehouse_id`, `triggered_at`, `resolved_at`                                                                                                                                                |

Movement types: `receipt` · `sale` · `return` · `transfer_in` · `transfer_out` ·
`adjustment` · `count_correction` · `write_off`.

Critical rules:

- `inv_stock_movements` is append-only: no `UPDATE`, no `DELETE`, no
  `deleted_at`. Mistakes are corrected with a compensating movement.
- `inv_stock_levels` is a **projection** and must always be reconstructible:
  `SUM(quantity)` over movements per `(variant_id, warehouse_id)` equals
  `quantity_on_hand`. A nightly reconciliation job asserts this and alerts on
  drift.
- `UNIQUE (organization_id, idempotency_key)` on movements — this is what makes
  POS offline sync safe to retry.
- Available quantity = `quantity_on_hand - quantity_reserved`. Never expose
  on-hand alone as "available".
- `UNIQUE (organization_id, sku)` and `UNIQUE (organization_id, barcode)` on
  variants, partial on `deleted_at IS NULL`.

---

## 9. POS schema (`pos_`)

| Table                             | Purpose                     | Notable columns                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pos_registers`                   | Tills                       | `name`, `code`, `warehouse_id` (Inventory id, **no FK**), `receipt_prefix`, `next_receipt_number bigint`, `is_active`                                                                                                                                                                                                                       |
| `pos_shifts`                      | Cash sessions               | `register_id`, `opened_by`, `opened_at`, `opening_float_amount_minor`, `closed_by`, `closed_at`, `counted_cash_amount_minor`, `expected_cash_amount_minor`, `variance_amount_minor`, `currency`, `status` (`open`\|`closed`)                                                                                                                |
| `pos_sales`                       | Completed sales             | `shift_id`, `register_id`, `receipt_number`, `customer_contact_id` (CRM id, **no FK**), `status` (`completed`\|`refunded`\|`partially_refunded`\|`voided`), `subtotal_*`, `discount_*`, `tax_*`, `total_*`, `currency`, `exchange_rate`, `base_total_amount_minor`, `locale`, `idempotency_key`, `sold_at`, `synced_at`, `client_device_id` |
| `pos_sale_lines`                  | Line items                  | `sale_id`, `variant_id` (Inventory id, no FK), `sku_snapshot`, `name_snapshot`, `quantity`, `unit_price_*`, `line_discount_*`, `tax_rate_bp`, `tax_*`, `line_total_*`                                                                                                                                                                       |
| `pos_payments`                    | Append-only payment records | `sale_id`, `method` (`cash`\|`card`\|`other`), `amount_*`, `tendered_amount_minor`, `change_amount_minor`, `reference`, `captured_at`                                                                                                                                                                                                       |
| `pos_refunds`, `pos_refund_lines` | Returns                     | `original_sale_id`, `reason_code`, `restock` (bool per line), `amount_*`, `refunded_at`                                                                                                                                                                                                                                                     |
| `pos_sync_log`                    | Offline sync audit          | `client_device_id`, `idempotency_key`, `payload jsonb`, `received_at`, `result`, `error_code`                                                                                                                                                                                                                                               |

Critical rules:

- `UNIQUE (organization_id, register_id, receipt_number)` — receipt numbers are
  sequential and gap-free per register.
- `UNIQUE (organization_id, idempotency_key)` on `pos_sales` — a retried offline
  sale can never create a duplicate.
- Only one shift per register may have `status = 'open'`: enforced by
  `CREATE UNIQUE INDEX uq_pos_shifts_open ON pos_shifts (organization_id, register_id) WHERE status = 'open'`.
- Line items store **snapshots** (`sku_snapshot`, `name_snapshot`, prices) so a
  historical receipt is reproducible even after the product changes or is
  deleted.
- `pos_payments` is append-only. A correction is a refund, never an edit.
- Stock deduction happens through `InventoryStockPort` **inside the same
  transaction** as sale creation.
- `check (total_amount_minor >= 0)` and `sum(payments) = total` are enforced by
  constraint and by domain invariant.

---

## 10. Migrations

| Rule                | Detail                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership           | Migrations live in the owning module: `modules/<key>/db/migrations/`. Platform migrations live in `packages/db/migrations/core/`.                                                                                    |
| Naming              | `NNNN_<verb>_<subject>.sql`, sequential per module (`0001_init.sql`, `0002_rls.sql`, `0003_add_reorder_point.sql`).                                                                                                  |
| RLS                 | Every migration that creates a tenant table **must** add the standard RLS block in the same migration or an immediately following `_rls.sql`. CI fails if a tenant table exists without a `tenant_isolation` policy. |
| Runner              | Executes as `modubiz_owner`. The app role never runs DDL.                                                                                                                                                            |
| Immutability        | A merged migration is never edited. Fix forward with a new migration.                                                                                                                                                |
| Reversibility       | Every migration ships a documented rollback plan (a `.down.sql` where mechanically possible; otherwise a written procedure in the PR).                                                                               |
| Destructive changes | Column drops and type narrowing use the expand/contract pattern across at least two releases: add new → backfill → dual-write → switch reads → drop old.                                                             |
| Zero-downtime       | `CREATE INDEX CONCURRENTLY` for indexes on large tables (outside a transaction block). New `NOT NULL` columns require a default or a backfill step.                                                                  |
| Data migrations     | Long backfills are BullMQ jobs with progress tracking and resumability, not inline in a DDL migration.                                                                                                               |
| Verification        | Applying all migrations to an empty database must equal the committed schema snapshot; a drift check runs in CI.                                                                                                     |

---

## 11. Query and performance rules

1. **Index `organization_id` first** in composite indexes — it is in the
   predicate of every tenant query via RLS.
2. All list endpoints are paginated (cursor-based by default; offset only for
   small bounded sets). No unbounded `SELECT *` on a tenant table.
3. No N+1: batch related reads inside the repository. Integration tests may
   assert query counts for hot paths.
4. Aggregate reports over ledgers (`inv_stock_movements`, `pos_sales`) use
   pre-aggregated projections or materialized views refreshed by a job — never a
   full ledger scan on the request path.
5. Soft-deleted rows are excluded by default in every repository; including them
   requires an explicit, named method.
6. Explicit transaction boundaries: one use case, one transaction. Never hold a
   transaction open across an external HTTP call.
7. Use `SELECT ... FOR UPDATE` when reading a value you are about to increment
   (receipt numbers, stock levels) to avoid lost updates; prefer a database
   sequence or a single atomic `UPDATE ... RETURNING` where possible.
8. Cache keys are always namespaced `org:<orgId>:...`. A cache lookup that could
   hit another tenant's entry is a security defect, not a performance bug.

---

## 12. Data retention and deletion

| Scenario                        | Behaviour                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business entity deleted by user | Soft delete (`deleted_at`); excluded from all reads; restorable by an admin within 30 days                                                                                      |
| Ledger row "deleted"            | Not possible. A compensating entry is appended                                                                                                                                  |
| Module disabled                 | Data retained for `dataRetentionDays` (descriptor, default 90); `purge_after` set on the entitlement; a job purges module tables for that org afterwards                        |
| Organization deleted            | 30-day `pending_deletion` grace period, then hard delete of all tenant rows across all module prefixes, driven by the module registry (each module registers its purge routine) |
| GDPR erasure of a person        | Personal fields pseudonymized in place; ledger and audit rows retained with the identity replaced by a stable pseudonym, preserving financial integrity                         |
| Audit log                       | Retained ≥ 12 months, then archived to cold storage; never modified                                                                                                             |

---

## 13. Related documents

[PRD.md](./PRD.md) · [TECH_STACK.md](./TECH_STACK.md) ·
[ARCHITECTURE.md](./ARCHITECTURE.md) · [MODULE_GUIDE.md](./MODULE_GUIDE.md) ·
[BUSINESS_RULES.md](./BUSINESS_RULES.md) ·
[CODING_STANDARDS.md](./CODING_STANDARDS.md) · [TESTING.md](./TESTING.md)
