import { describe, expect, it } from 'vitest';

import {
  CRM_EVENTS,
  INVENTORY_EVENTS,
  crmContactCreatedV1Schema,
  crmContactUpdatedV1Schema,
  crmDealLostV1Schema,
  crmDealStageChangedV1Schema,
  crmDealWonV1Schema,
  inventoryProductArchivedV1Schema,
  inventoryProductCreatedV1Schema,
  inventoryProductRestoredV1Schema,
  inventoryReorderPointReachedV1Schema,
  inventoryStockDepletedV1Schema,
  inventoryStockLevelChangedV1Schema,
} from '../src/events/index.js';
import { MODULE_KEYS, type EventName } from '../src/module/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const orgId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// ─── Event names ────────────────────────────────────────────────────────────

describe('CRM event names (PLAN.md §4.1)', () => {
  it('declares exactly the five planned events', () => {
    expect(Object.values(CRM_EVENTS).sort()).toEqual([
      'crm.contact.created.v1',
      'crm.contact.updated.v1',
      'crm.deal.lost.v1',
      'crm.deal.stage_changed.v1',
      'crm.deal.won.v1',
    ]);
  });

  it('every event name matches the EventName format and the CRM module key', () => {
    const names: EventName[] = Object.values(CRM_EVENTS);
    for (const name of names) {
      expect(name.startsWith(`${MODULE_KEYS.CRM}.`)).toBe(true);
      expect(name).toMatch(/^crm\.[a-z_]+\.(created|updated|stage_changed|won|lost)\.v1$/);
    }
  });
});

// ─── crm.contact.created.v1 ─────────────────────────────────────────────────

describe('crmContactCreatedV1Schema', () => {
  const valid = {
    organizationId: orgId,
    contactId: id,
    companyId: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: null,
    secondaryPhone: null,
    ownerUserId: userId,
    occurredAt: '2026-08-03T10:00:00.000Z',
  };

  it('accepts a valid payload (CRM-1: email present, phone null)', () => {
    expect(crmContactCreatedV1Schema.parse(valid)).toEqual(valid);
  });

  it('accepts a contact with phone and no email (CRM-1 either-or)', () => {
    const payload = { ...valid, email: null, phone: '+44 20 7946 0958' };
    expect(crmContactCreatedV1Schema.parse(payload).phone).toBe('+44 20 7946 0958');
  });

  it('accepts an unowned contact', () => {
    expect(crmContactCreatedV1Schema.parse({ ...valid, ownerUserId: null }).ownerUserId).toBeNull();
  });

  it('CRM-1: rejects a contact with neither email nor phone', () => {
    expect(() => crmContactCreatedV1Schema.parse({ ...valid, email: null, phone: null })).toThrow();
  });

  it('rejects a non-uuid contactId', () => {
    expect(() => crmContactCreatedV1Schema.parse({ ...valid, contactId: 'not-a-uuid' })).toThrow();
  });

  it('rejects a missing organizationId (tenant context is part of the payload)', () => {
    const { organizationId: _omit, ...rest } = valid;
    expect(() => crmContactCreatedV1Schema.parse(rest)).toThrow();
  });

  it('rejects a malformed email', () => {
    expect(() => crmContactCreatedV1Schema.parse({ ...valid, email: 'not-an-email' })).toThrow();
  });

  it('rejects a non-datetime occurredAt', () => {
    expect(() => crmContactCreatedV1Schema.parse({ ...valid, occurredAt: 'yesterday' })).toThrow();
  });
});

// ─── crm.contact.updated.v1 ─────────────────────────────────────────────────

describe('crmContactUpdatedV1Schema', () => {
  const valid = {
    organizationId: orgId,
    contactId: id,
    companyId: id,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+44 20 7946 0958',
    secondaryPhone: '+1 415 555 0132',
    ownerUserId: userId,
    occurredAt: '2026-08-03T11:00:00.000Z',
  };

  it('accepts a valid update payload', () => {
    expect(crmContactUpdatedV1Schema.parse(valid)).toEqual(valid);
  });

  it('rejects a malformed email string', () => {
    expect(() => crmContactUpdatedV1Schema.parse({ ...valid, email: 'ada' })).toThrow();
  });

  it('CRM-1: rejects an update that drops both email and phone', () => {
    expect(() => crmContactUpdatedV1Schema.parse({ ...valid, email: null, phone: null })).toThrow();
  });
});

// ─── crm.deal.stage_changed.v1 ──────────────────────────────────────────────

describe('crmDealStageChangedV1Schema', () => {
  const fromStageId = '11111111-1111-1111-1111-111111111111';
  const toStageId = '22222222-2222-2222-2222-222222222222';

  const valid = {
    organizationId: orgId,
    dealId: id,
    fromStageId,
    toStageId,
    movedBy: userId,
    occurredAt: '2026-08-03T12:00:00.000Z',
  };

  it('accepts a valid stage change (CRM-6)', () => {
    expect(crmDealStageChangedV1Schema.parse(valid)).toEqual(valid);
  });

  it('accepts null fromStageId for the first move', () => {
    expect(crmDealStageChangedV1Schema.parse({ ...valid, fromStageId: null }).fromStageId).toBeNull();
  });

  it('rejects a missing toStageId', () => {
    const { toStageId: _omit, ...rest } = valid;
    expect(() => crmDealStageChangedV1Schema.parse(rest)).toThrow();
  });
});

// ─── crm.deal.won.v1 ────────────────────────────────────────────────────────

describe('crmDealWonV1Schema', () => {
  const valid = {
    organizationId: orgId,
    dealId: id,
    valueAmountMinor: '250000',
    valueCurrency: 'USD',
    closedAt: '2026-08-03T13:00:00.000Z',
    ownerUserId: userId,
    occurredAt: '2026-08-03T13:00:00.000Z',
  };

  it('accepts a valid won payload with integer minor units (CRM-8, M1)', () => {
    expect(crmDealWonV1Schema.parse(valid)).toEqual(valid);
  });

  it('accepts an unowned won deal', () => {
    expect(crmDealWonV1Schema.parse({ ...valid, ownerUserId: null }).ownerUserId).toBeNull();
  });

  it('accepts the FX snapshot when the deal currency differs from base (CRM-8, CUR-5)', () => {
    const payload = {
      ...valid,
      exchangeRate: '3.6725',
      baseAmountMinor: '68062',
    };
    expect(crmDealWonV1Schema.parse(payload)).toEqual(payload);
  });

  it('rejects a float exchange rate (CUR-5 precision)', () => {
    expect(() => crmDealWonV1Schema.parse({ ...valid, exchangeRate: '3.67e1' })).toThrow();
  });

  it('rejects a float amount — money never travels as a float (M1)', () => {
    expect(() => crmDealWonV1Schema.parse({ ...valid, valueAmountMinor: '2500.00' })).toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() => crmDealWonV1Schema.parse({ ...valid, valueAmountMinor: '-250000' })).toThrow();
  });

  it('rejects a lowercase currency code (M2)', () => {
    expect(() => crmDealWonV1Schema.parse({ ...valid, valueCurrency: 'usd' })).toThrow();
  });

  it('rejects a non-ISO currency length', () => {
    expect(() => crmDealWonV1Schema.parse({ ...valid, valueCurrency: 'US' })).toThrow();
  });
});

// ─── crm.deal.lost.v1 ───────────────────────────────────────────────────────

describe('crmDealLostV1Schema', () => {
  const valid = {
    organizationId: orgId,
    dealId: id,
    lostReasonCode: 'PRICE',
    closedAt: '2026-08-03T14:00:00.000Z',
    ownerUserId: userId,
    occurredAt: '2026-08-03T14:00:00.000Z',
  };

  it('accepts a valid lost payload with a reason code (CRM-7)', () => {
    expect(crmDealLostV1Schema.parse(valid)).toEqual(valid);
  });

  it('rejects a missing lostReasonCode (CRM-7)', () => {
    const { lostReasonCode: _omit, ...rest } = valid;
    expect(() => crmDealLostV1Schema.parse(rest)).toThrow();
  });
});

// ─── Inventory events (PLAN.md §5.1) ────────────────────────────────────────

describe('Inventory event names (PLAN.md §5.1)', () => {
  it('declares exactly the six planned events', () => {
    expect(Object.values(INVENTORY_EVENTS).sort()).toEqual([
      'inventory.product.archived.v1',
      'inventory.product.created.v1',
      'inventory.product.restored.v1',
      'inventory.reorder_point.reached.v1',
      'inventory.stock.depleted.v1',
      'inventory.stock.level_changed.v1',
    ]);
  });

  it('every event name matches the EventName format and the INVENTORY module key', () => {
    const names: EventName[] = Object.values(INVENTORY_EVENTS);
    for (const name of names) {
      expect(name.startsWith(`${MODULE_KEYS.INVENTORY}.`)).toBe(true);
      expect(name).toMatch(/^inventory\.[a-z_]+\.(created|archived|restored|level_changed|depleted|reached)\.v1$/);
    }
  });
});

// ─── inventory.product.created.v1 ───────────────────────────────────────────

describe('inventoryProductCreatedV1Schema', () => {
  const valid = {
    organizationId: orgId,
    productId: id,
    nameI18n: { en: 'Espresso' },
    variantId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    sku: 'ESP-001',
    isActive: true,
    occurredAt: '2026-08-04T09:00:00.000Z',
  };

  it('accepts a valid product-created payload (INV-10: sku present)', () => {
    expect(inventoryProductCreatedV1Schema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty sku', () => {
    expect(() => inventoryProductCreatedV1Schema.parse({ ...valid, sku: '' })).toThrow();
  });

  it('rejects a non-uuid variantId', () => {
    expect(() => inventoryProductCreatedV1Schema.parse({ ...valid, variantId: 'nope' })).toThrow();
  });
});

// ─── inventory.product.archived.v1 ──────────────────────────────────────────

describe('inventoryProductArchivedV1Schema', () => {
  const valid = {
    organizationId: orgId,
    productId: id,
    variantIds: ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
    archivedAt: '2026-08-04T10:00:00.000Z',
    occurredAt: '2026-08-04T10:00:00.000Z',
  };

  it('accepts a valid archive payload (INV-11: archive, never hard-delete)', () => {
    expect(inventoryProductArchivedV1Schema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty variantIds array (archive is a soft-delete of sellable units)', () => {
    expect(() => inventoryProductArchivedV1Schema.parse({ ...valid, variantIds: [] })).toThrow();
  });
});

// ─── inventory.product.restored.v1 ──────────────────────────────────────────

describe('inventoryProductRestoredV1Schema', () => {
  const valid = {
    organizationId: orgId,
    productId: id,
    variantIds: ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
    restoredAt: '2026-08-04T10:30:00.000Z',
    occurredAt: '2026-08-04T10:30:00.000Z',
  };

  it('accepts a valid restore payload (inverse of INV-11 archive)', () => {
    expect(inventoryProductRestoredV1Schema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty variantIds array (a restore always covers sellable units)', () => {
    expect(() => inventoryProductRestoredV1Schema.parse({ ...valid, variantIds: [] })).toThrow();
  });

  it('rejects a non-uuid productId', () => {
    expect(() => inventoryProductRestoredV1Schema.parse({ ...valid, productId: 'nope' })).toThrow();
  });
});

// ─── inventory.stock.level_changed.v1 ───────────────────────────────────────

describe('inventoryStockLevelChangedV1Schema', () => {
  const valid = {
    organizationId: orgId,
    variantId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    warehouseId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    movementId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    movementType: 'receipt' as const,
    quantity: '10',
    quantityOnHand: '10',
    quantityReserved: '0',
    occurredAt: '2026-08-04T11:00:00.000Z',
  };

  it('accepts a valid level-changed payload (INV-2: projection follows the ledger)', () => {
    expect(inventoryStockLevelChangedV1Schema.parse(valid)).toEqual(valid);
  });

  it('accepts a fractional quantity (INV-15: numeric(18,4) UoM units)', () => {
    const payload = { ...valid, quantity: '0.5000' };
    expect(inventoryStockLevelChangedV1Schema.parse(payload).quantity).toBe('0.5000');
  });

  it('rejects an unknown movement type', () => {
    expect(() => inventoryStockLevelChangedV1Schema.parse({ ...valid, movementType: 'magic' })).toThrow();
  });

  it('rejects a scientific-notation quantity (no floats in the payload)', () => {
    expect(() => inventoryStockLevelChangedV1Schema.parse({ ...valid, quantity: '1e2' })).toThrow();
  });
});

// ─── inventory.stock.depleted.v1 ────────────────────────────────────────────

describe('inventoryStockDepletedV1Schema', () => {
  const valid = {
    organizationId: orgId,
    variantId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    warehouseId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    quantityOnHand: '0',
    quantityReserved: '0',
    quantityAvailable: '0',
    occurredAt: '2026-08-04T12:00:00.000Z',
  };

  it('accepts a valid depletion payload (INV-6: available crosses zero)', () => {
    expect(inventoryStockDepletedV1Schema.parse(valid)).toEqual(valid);
  });

  it('rejects a missing quantityAvailable (INV-5: available is the sales gate)', () => {
    const { quantityAvailable: _omit, ...rest } = valid;
    expect(() => inventoryStockDepletedV1Schema.parse(rest)).toThrow();
  });
});

// ─── inventory.reorder_point.reached.v1 ─────────────────────────────────────

describe('inventoryReorderPointReachedV1Schema', () => {
  const valid = {
    organizationId: orgId,
    variantId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    warehouseId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    quantityAvailable: '4.5',
    reorderPoint: '5',
    occurredAt: '2026-08-04T13:00:00.000Z',
  };

  it('accepts a valid reorder-point payload (INV-13: available crosses below reorder point)', () => {
    expect(inventoryReorderPointReachedV1Schema.parse(valid)).toEqual(valid);
  });

  it('rejects a non-decimal reorderPoint', () => {
    expect(() => inventoryReorderPointReachedV1Schema.parse({ ...valid, reorderPoint: 'five' })).toThrow();
  });
});
