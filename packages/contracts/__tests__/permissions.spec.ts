import { describe, expect, it } from 'vitest';

import {
  ACCOUNTING_PERMISSIONS,
  ALL_PERMISSIONS,
  CRM_PERMISSIONS,
  INVENTORY_PERMISSIONS,
  POS_PERMISSIONS,
  PURCHASING_PERMISSIONS,
} from '../src/permissions/index.js';

// ─── ALL_PERMISSIONS aggregate integrity ────────────────────────────────────
//
// Regression guard: POS_PERMISSIONS.REPORT_VIEW ('pos:report:view') and the
// accounting catalog's REPORT_VIEW ('accounting:report:view') shared the same
// object KEY. In `ALL_PERMISSIONS = { ...POS, ...ACCOUNTING }` the last spread
// wins for duplicate keys, so `pos:report:view` silently vanished from the
// catalog — and from every system-role token minted via SYSTEM_ROLE_PERMISSIONS
// — leaving every `pos:report:view`-gated route (reports, sale detail, receipt
// print) returning 403 FORBIDDEN even for the org owner.

describe('ALL_PERMISSIONS — aggregate integrity (AUTHZ-5 role matrix source)', () => {
  it('keeps every value from every module catalog (no value lost to a key collision)', () => {
    const moduleObjects = [
      CRM_PERMISSIONS,
      INVENTORY_PERMISSIONS,
      POS_PERMISSIONS,
      ACCOUNTING_PERMISSIONS,
      PURCHASING_PERMISSIONS,
    ];
    const allValues = new Set(Object.values(ALL_PERMISSIONS));
    for (const mod of moduleObjects) {
      for (const value of Object.values(mod)) {
        expect(allValues.has(value), `missing from ALL_PERMISSIONS: ${value}`).toBe(true);
      }
    }
  });

  it('declares the read/report permissions that system roles rely on', () => {
    // POS REPORT_VIEW was the one that got dropped by the collision — pin the
    // high-risk report permissions explicitly so a regression fails loudly.
    expect(Object.values(ALL_PERMISSIONS)).toContain('pos:report:view');
    expect(Object.values(ALL_PERMISSIONS)).toContain('accounting:report:view');
    expect(Object.values(ALL_PERMISSIONS)).toContain('crm:contact:read');
    expect(Object.values(ALL_PERMISSIONS)).toContain('inventory:product:read');
    expect(Object.values(ALL_PERMISSIONS)).toContain('pos:sale:create');
    expect(Object.values(ALL_PERMISSIONS)).toContain('accounting:invoice:write');
    expect(Object.values(ALL_PERMISSIONS)).toContain('purchasing:report:view');
    expect(Object.values(ALL_PERMISSIONS)).toContain('purchasing:supplier:read');
  });

  it('has no duplicate permission strings', () => {
    const values = Object.values(ALL_PERMISSIONS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('uses distinct object keys across module catalogs so spreads never overwrite', () => {
    // The root cause: two catalogs both used the key REPORT_VIEW. The aggregate
    // must be exactly as large as the sum of the module catalogs.
    const sum =
      Object.keys(CRM_PERMISSIONS).length +
      Object.keys(INVENTORY_PERMISSIONS).length +
      Object.keys(POS_PERMISSIONS).length +
      Object.keys(ACCOUNTING_PERMISSIONS).length +
      Object.keys(PURCHASING_PERMISSIONS).length;
    expect(Object.keys(ALL_PERMISSIONS).length).toBe(sum);
  });
});
