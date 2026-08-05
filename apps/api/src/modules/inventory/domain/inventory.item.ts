/**
 * Trivial scaffold entity for the inventory module.
 * Pure TypeScript — no framework, no I/O (hard rule #7).
 *
 * Replace with the module's real aggregates and invariants, citing the
 * business rules they enforce (see MODULE_GUIDE.md §4 Step 4).
 */
export class InventoryItem {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}
