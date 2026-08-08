# Inventory Module — Frontend Specification (Phase 5.10)

**Status:** Approved for implementation (2026-08-06). **Governing docs:**
[UI_UX_GUIDELINES.md](./UI_UX_GUIDELINES.md) ·
[DATA_MODEL.md §8](./DATA_MODEL.md#8-inventory-schema-inv_) ·
[BUSINESS_RULES.md §8](./BUSINESS_RULES.md#8-inventory-rules) ·
[PRD.md §Inventory](./PRD.md) · AGENTS.md hard rules.

This spec brings the inventory frontend to the same professional bar as the CRM
module: detail pages, variant management, search/filter/pagination, warehouse
management, and contextual stock actions — while respecting every hard rule
(i18n keys only, logical CSS, `Money` math, `ModuleGate`/`Can` gating, RTL).

---

## 1. Current state vs. target

| Area         | Today                            | Target                                                                    |
| ------------ | -------------------------------- | ------------------------------------------------------------------------- |
| Products     | flat table, create form, archive | **detail page** + variants grid, search, status filter, card/table toggle |
| Variants     | implicit (1 per product)         | **explicit**: add variant, archive variant, per-variant stock             |
| Warehouses   | read-only list                   | **create warehouse**, detail page, stock-per-warehouse view               |
| Stock levels | flat table                       | search, warehouse filter, low-stock filter, per-variant stock mini-view   |
| Movements    | flat ledger                      | filters (type, date, search), movement-type badges                        |
| Transfers    | flat list + form                 | detail pairing stays; filters                                             |
| Stock counts | flat list                        | **count detail page** (lines, variances, apply), search/filter by status  |
| Reservations | API only                         | **reservations list** with release/commit actions                         |
| Dashboard    | 2 widgets                        | keep + link rows to detail pages                                          |
| Lists        | none have search/pagination      | all lists: search + filters + pagination (CRM `Pagination` pattern)       |

---

## 2. Information architecture (routes)

```
/m/inventory                        → redirect /m/inventory/products
/m/inventory/products               list (cards ⇄ table toggle, search, status filter)
/m/inventory/products/[id]          PRODUCT DETAIL (NEW)
/m/inventory/warehouses             list + create (NEW create)
/m/inventory/warehouses/[id]        WAREHOUSE DETAIL (NEW)
/m/inventory/stock                  stock levels (search + warehouse + low-stock filters)
/m/inventory/stock/movements        ledger (type/date/search filters)
/m/inventory/stock/transfers        transfers list + transfer form
/m/inventory/stock-counts           counts list (status filter)
/m/inventory/stock-counts/[id]      COUNT DETAIL (NEW)
/m/inventory/reservations           reservations (NEW)
```

Every route stays under `app/[locale]/(dashboard)/m/inventory/`, gated by
`<ModuleGate moduleKey="inventory">`; mutating controls wrapped in `<Can>`.

---

## 3. Backend support required (small, additive)

The current API lacks the reads/writes the detail pages and variant management
need. All are additive use-case + controller routes (no schema changes):

| Endpoint                                   | Purpose                                          | Permission                  |
| ------------------------------------------ | ------------------------------------------------ | --------------------------- |
| `GET /v1/inventory/products/:id`           | product + variants + stock summary               | `inventory:product:read`    |
| `POST /v1/inventory/products/:id/variants` | add a variant (INV-10 SKU check)                 | `inventory:product:write`   |
| `POST /v1/inventory/variants/:id/archive`  | archive one variant (INV-11)                     | `inventory:product:write`   |
| `POST /v1/inventory/warehouses`            | create a warehouse (first non-default)           | `inventory:warehouse:write` |
| `GET /v1/inventory/warehouses/:id`         | warehouse detail + its stock                     | `inventory:product:read`    |
| `GET /v1/inventory/stock`                  | + `search`, `warehouseId`, `lowStock` filters    | `inventory:product:read`    |
| `GET /v1/inventory/stock/movements`        | + `type`, `fromDate`, `toDate`, `search` filters | `inventory:product:read`    |
| `GET /v1/inventory/stock-counts/:id`       | count detail (lines with variant names)          | `inventory:stock:count`     |
| `GET /v1/inventory/reservations`           | list reservations (status filter)                | `inventory:product:read`    |
| `GET /v1/inventory/stock-counts`           | + `status` filter                                | `inventory:stock:count`     |
| `GET /v1/inventory/products`               | + `search`, `status` filters                     | `inventory:product:read`    |

Repository additions (all tenant-scoped, RLS only): `findProductById`,
`listVariantsByProduct`, `insertVariant` (already exists — reuse for
add-variant), `archiveVariant`, `insertWarehouse`, `findWarehouseById` (exists),
`listReservations`, `listStockCounts` with status filter.

---

## 4. Shared UI inventory (reuse CRM patterns)

- **`PageHeader`** — icon chip + title + subtitle + actions row (CRM workspace
  header).
- **`InventoryTable`** — the existing table primitives, extracted into one
  shared component (loading / empty / rows / footer).
- **`SearchInput`** — `Search` icon + `Input` with `ps-9` (CRM ContactsSection).
- **`FilterSelect`** — labeled `Select` for warehouse/status/type filters.
- **`Pagination`** — reuse CRM `Pagination` (`list.total`, `list.pageOf`…).
- **`StatusBadge`** — `active/archived`, `inStock/lowStock`, `draft/applied`.
- **`MovementTypeBadge`** — color-coded movement types (in/out/transfer/count).
- **`Empty`** — CRM dashed empty state.
- **`ViewToggle`** — cards ⇄ table (CRM `table-shared`).
- **`StatCard`** — small KPI card (per-warehouse totals, count totals).

---

## 5. Page specifications

### 5.1 Products list (`/m/inventory/products`)

- **Header:** "Products" + subtitle; actions: **Add product** (primary, `Can`
  write).
- **Toolbar:** search (name/SKU/barcode), status filter
  (`All`/`Active`/`Archived`), ViewToggle.
- **Cards:** name (localized, `dir="auto"`), SKU chip, price, active badge,
  low-stock hint → click opens detail. **Table:** name, SKU, barcode, price,
  reorder, status, actions (Archive with `ConfirmDialog`, disabled when
  archived).
- **Empty:** "No products yet — create your first product."
- **i18n:** `products.searchPlaceholder`, `products.filterStatus`,
  `allStatuses`, `active`, `archived`, `viewCards`, `viewTable`,
  `products.empty`.

### 5.2 Product detail (`/m/inventory/products/[id]`) — NEW

- **Header:** product name, SKU, status badge; actions: **Add variant** (`Can`
  write), **Archive product** (confirm dialog), back link.
- **Overview card:** name, description (if present), SKU, barcode, price, cost,
  reorder point/quantity, created/updated stamps, active badge.
- **Variants card (the core ask):** table of variants — SKU, barcode, price,
  cost, reorder, **on-hand/available per warehouse** (from stock query), status;
  row actions: **Receive / Adjust / Transfer** (inline dialogs, `Can`
  stock:adjust / transfer:execute), **Archive variant** (confirm).
- **Stock history card:** the variant's movements (reuse movements rows,
  filtered client-side or via a new `?variantId=` query).
- **i18n:** `products.detail.*`, `variants.*` (addVariant, archiveVariant,
  perWarehouse…).

### 5.3 Add variant dialog (from product detail)

- Fields: SKU (required, INV-10), barcode, price (money pair), cost (money
  pair), reorder point, reorder quantity. Posts `POST /products/:id/variants`.
- Client pre-check against the loaded variants for duplicate SKU.

### 5.4 Warehouses list (`/m/inventory/warehouses`)

- Header + **Add warehouse** (NEW, `Can` warehouse:write) → form: name, code,
  optional "make default" (only if none exists).
- Table: name, code, default badge, active badge. Rows link to warehouse detail.
- **i18n:** `warehouses.create`, `warehouses.createMessage`, `fields.name`,
  `fields.code`, `fields.makeDefault`.

### 5.5 Warehouse detail (`/m/inventory/warehouses/[id]`) — NEW

- Header: name/code/default badge; back link.
- **Stock card:** products in this warehouse — SKU, name, on-hand, reserved,
  available, reorder, low-stock badge.
- **i18n:** `warehouses.detail.*`, reuse `stock.table*` keys.

### 5.6 Stock levels (`/m/inventory/stock`)

- Toolbar: search (product/SKU), warehouse filter, **low-stock only** toggle
  (chip, `aria-pressed`, mirrors CRM "Assigned to me" pattern).
- Table: product, SKU, warehouse, on-hand, reserved, available, reorder, status
  badge; row actions: **Receive** / **Adjust** (inline forms, prefilled
  variant+warehouse).
- Empty: "No stock movements yet — receive stock to get started."
- **i18n:** `stock.lowStockOnly`, `stock.allWarehouses`,
  `stock.searchPlaceholder`.

### 5.7 Movements ledger (`/m/inventory/stock/movements`)

- Keep append-only hint (`Lock`).
- Toolbar: search (product/SKU), type filter, From/To date inputs, Clear.
- Table: date, product, type badge, warehouse, quantity (+/− colored), unit
  cost, reference, reason.
- **i18n:** `movements.searchPlaceholder`, `movements.filterType`, `allTypes`,
  `fromDate`, `toDate`, `clearDates`.

### 5.8 Transfers (`/m/inventory/stock/transfers`)

- Keep paired from→to rows; add search + from-warehouse filter.
- **i18n:** `transfers.searchPlaceholder`, `transfers.filterFromWarehouse`.

### 5.9 Stock counts (`/m/inventory/stock-counts`)

- Toolbar: status filter (`All`/`Draft`/`Applied`).
- Table: date, warehouse, status badge, notes; row actions: **Start count**
  (primary), **Apply** (draft only, confirm dialog), **View** → detail page.
- **i18n:** `stockCounts.filterStatus`, `allStatuses`, `draft`, `applied`.

### 5.10 Stock count detail (`/m/inventory/stock-counts/[id]`) — NEW

- Header: warehouse, status badge, dates; actions: **Apply** (draft only).
- **Lines card:** variant, expected, counted, variance (colored), per line.
- **i18n:** `stockCounts.detail.*`, `lines.variant`, `lines.expected`,
  `lines.counted`, `lines.variance`.

### 5.11 Reservations (`/m/inventory/reservations`) — NEW

- Header + status filter (held/committed/released/expired).
- Table: product, warehouse, quantity, expires-at (with overdue styling),
  reference, status badge; row actions: **Release** / **Commit** (`Can`
  stock:adjust) with confirm dialogs; committed/expired rows are inert.
- **i18n:** `reservations.*` (title, statuses, release, commit,
  releaseMessage…).

### 5.12 Dashboard widgets

- Low-stock widget rows → link to `/m/inventory/stock?lowStock=1`.
- Valuation widget → link to `/m/inventory/stock`.

---

## 6. Data-flow conventions

- **Hooks** — one hook per resource in `features/inventory/hooks.ts`:
  `useInventoryProduct(id)`, `useInventoryVariants(id)`,
  `useInventoryWarehouse(id)`, `useInventoryReservations()`,
  `useInventoryStock(filters)`, `useInventoryMovements(filters)`. Query keys:
  `['inventory', 'products', id]`, `['inventory', 'stock', filters]`, …
- **Mutations** — extend `useInventoryMutations()`: `createVariant`,
  `archiveVariant`, `createWarehouse`; all invalidate `['inventory']`; detail
  mutations invalidate their parent product key too.
- **Money** — all amounts are string minor units; format via `formatMinorAmount`
  with currency exponent from `useCurrencies()`. No floats, no `toFixed` (rule
  #3).
- **Errors** — API codes → `inventoryErrorKey(code)` → `t(key)` (never raw
  strings).

---

## 7. i18n plan

All new keys added to `en`, `ar`, `fr`, `es` under `modules.inventory.*` (parity
test enforces completeness). Roughly 60 new keys: `variants.*` (~12),
`warehouses.create*` (~5), `products.detail.*` (~6), `stockCounts.detail.*`
(~5), `reservations.*` (~10), filters/search/status keys (~15), misc (~7).

---

## 8. Testing plan

- **Unit:** money helpers (extended), `inventoryErrorKey`, schemas (variant +
  warehouse forms), movement-type/label helpers.
- **Component:** low-stock filter chip, status badges, count-detail variance
  formatting.
- **i18n:** existing parity spec auto-covers new keys.
- **Integration (backend):** product detail round-trip, add/archive variant
  (INV-10/11), warehouse create, reservation list, count detail, filters on
  stock/movements.
- **Isolation:** add-variant + create-warehouse cross-org denial (extends the
  5.9 suite).
- **E2E:** extend `inventory-journey.e2e.spec.ts` — create product → add variant
  → receive → stock filters → apply count.

## 9. Definition of done

- [ ] All pages render in `en` + `ar` (RTL) with logical CSS only.
- [ ] Every user-facing string is an i18n key present in all 4 locales.
- [ ] Every money value goes through `formatMinorAmount`; no float math.
- [ ] Detail/action routes gated (`ModuleGate`); mutations gated (`Can`).
- [ ] Web typecheck + lint clean; web tests + i18n parity green.
- [ ] Backend additions covered by integration + isolation tests; arch tests
      green.
- [ ] OpenAPI + `@modubiz/api-client` regenerated for new/changed routes.
- [ ] PROGRESS.md session entry updated.
