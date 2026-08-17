import { describe, expect, it } from 'vitest';

import { INVENTORY_EVENTS } from '@modubiz/contracts';

import { inventoryDescriptor } from '../../inventory.descriptor.js';

// Integration tests for the inventory module run against real Postgres with RLS
// active (TESTING.md §4). Add use-case-level tests here once implemented.
describe('inventory module integration', () => {
  it('registers a valid module descriptor', () => {
    expect(inventoryDescriptor.key).toBe('inventory');
    expect(inventoryDescriptor.tablePrefix).toBe('inv_');
  });

  it('Phase 7.0: publishes movement_recorded and provides the movement port', () => {
    // ACC-15: the full-movement event the GL posts from.
    expect(inventoryDescriptor.publishes).toContain(INVENTORY_EVENTS.MOVEMENT_RECORDED_V1);

    // Level 3 movement port — receive/issue/returnToSupplier/adjustCost.
    const movementPort = inventoryDescriptor.providesPorts.find((p) => p.token === 'INVENTORY_MOVEMENT_PORT');
    expect(movementPort).toBeDefined();
    expect(movementPort?.transactional).toBe(true);

    // The reservation-oriented stock port is still provided (POS-15).
    const stockPort = inventoryDescriptor.providesPorts.find((p) => p.token === 'INVENTORY_STOCK_PORT');
    expect(stockPort).toBeDefined();
    expect(stockPort?.transactional).toBe(true);
  });
});
