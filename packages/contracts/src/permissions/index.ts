// Permission keys
// Format: `<module>:<resource>:<action>` per CODING_STANDARDS.md §2
//
// Each module declares its permissions here.
// The permission catalog is mirrored to `core_permissions` at boot.

// ─── CRM permissions ───────────────────────────────────────────────────────

export const CRM_PERMISSIONS = {
  CONTACT_READ: 'crm:contact:read',
  CONTACT_WRITE: 'crm:contact:write',
  COMPANY_READ: 'crm:company:read',
  COMPANY_WRITE: 'crm:company:write',
  DEAL_READ: 'crm:deal:read',
  DEAL_WRITE: 'crm:deal:write',
  ACTIVITY_READ: 'crm:activity:read',
  ACTIVITY_WRITE: 'crm:activity:write',
  PIPELINE_MANAGE: 'crm:pipeline:manage',
} as const;

// ─── Inventory permissions ─────────────────────────────────────────────────

export const INVENTORY_PERMISSIONS = {
  PRODUCT_READ: 'inventory:product:read',
  PRODUCT_WRITE: 'inventory:product:write',
  STOCK_ADJUST: 'inventory:stock:adjust',
  STOCK_COUNT: 'inventory:stock:count',
  WAREHOUSE_WRITE: 'inventory:warehouse:write',
  TRANSFER_EXECUTE: 'inventory:transfer:execute',
} as const;

// ─── POS permissions ───────────────────────────────────────────────────────

export const POS_PERMISSIONS = {
  REGISTER_MANAGE: 'pos:register:manage',
  SHIFT_OPEN: 'pos:shift:open',
  SHIFT_CLOSE: 'pos:shift:close',
  SALE_CREATE: 'pos:sale:create',
  REFUND_PROCESS: 'pos:refund:process',
  REPORT_VIEW: 'pos:report:view',
} as const;

// ─── Aggregate ─────────────────────────────────────────────────────────────

export const ALL_PERMISSIONS = {
  ...CRM_PERMISSIONS,
  ...INVENTORY_PERMISSIONS,
  ...POS_PERMISSIONS,
} as const;

export type Permission = (typeof ALL_PERMISSIONS)[keyof typeof ALL_PERMISSIONS];
