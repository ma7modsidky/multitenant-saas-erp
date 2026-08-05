import { ALL_PERMISSIONS } from '@modubiz/contracts';

import { DomainError } from '../../../core/common/errors.js';

import { SYSTEM_ROLE_IMMUTABLE, LAST_OWNER_ROLE, CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED } from './errors.js';

/**
 * System role keys — the hardcoded role matrix per BUSINESS_RULES.md §3.
 */
export const SYSTEM_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/**
 * Platform permission keys reserved to OWNER/ADMIN (AUTHZ-4).
 * Custom roles may never include these.
 */
export const PLATFORM_PERMISSIONS = [
  'platform:organization:delete',
  'platform:ownership:transfer',
  'platform:billing:manage',
  'platform:modules:enable',
  'platform:modules:disable',
  'platform:members:invite',
  'platform:members:remove',
  'platform:members:assign-role',
  'platform:roles:manage',
  'platform:settings:manage',
  'platform:audit:view',
] as const;

/**
 * Module permission actions treated as "module configuration" per
 * BUSINESS_RULES.md §3 (warehouses, registers, pipelines) — granted to
 * OWNER/ADMIN/MANAGER only, never to MEMBER/VIEWER.
 *
 * Permissions whose action segment is `manage` are classified as config
 * automatically; this set covers the write-style keys that still configure
 * a module resource.
 */
const MODULE_CONFIG_EXTRA = new Set(['inventory:warehouse:write']);

type ModulePermissionClass = 'read' | 'write' | 'config';

/** Classify a module permission key (`<module>:<resource>:<action>`) by action. */
function classifyModulePermission(permission: string): ModulePermissionClass {
  const action = permission.split(':')[2];
  if (action === 'read' || action === 'view') return 'read';
  if (action === 'manage') return 'config';
  return 'write';
}

const ALL_MODULE_PERMISSIONS = Object.values(ALL_PERMISSIONS);

const MODULE_READ_PERMISSIONS = ALL_MODULE_PERMISSIONS.filter((p) => classifyModulePermission(p) === 'read');
const MODULE_WRITE_PERMISSIONS = ALL_MODULE_PERMISSIONS.filter(
  (p) => classifyModulePermission(p) === 'write' && !MODULE_CONFIG_EXTRA.has(p),
);
const MODULE_CONFIG_PERMISSIONS = ALL_MODULE_PERMISSIONS.filter(
  (p) => classifyModulePermission(p) === 'config' || MODULE_CONFIG_EXTRA.has(p),
);

/** Module data read — every role including VIEWER. */
const MODULE_DATA_READ = [...MODULE_READ_PERMISSIONS];
/** Module data write — every role except VIEWER. */
const MODULE_DATA_WRITE = [...MODULE_WRITE_PERMISSIONS];
/** Module configuration — OWNER/ADMIN/MANAGER only. */
const MODULE_CONFIG = [...MODULE_CONFIG_PERMISSIONS];
/** Every registered module permission — full-access roles. */
const ALL_MODULES = [...MODULE_DATA_READ, ...MODULE_DATA_WRITE, ...MODULE_CONFIG];

/**
 * The built-in role-to-permission matrix for system roles.
 * Maps each system role key to its granted permissions.
 *
 * Module permissions are derived from the registered module descriptors
 * (`@modubiz/contracts` ALL_PERMISSIONS) so adding a module does not require
 * editing the matrix by hand — the classification follows BUSINESS_RULES.md §3:
 *   - Module data read: all roles
 *   - Module data write: all roles except VIEWER
 *   - Module configuration (warehouses, registers, pipelines): OWNER/ADMIN/MANAGER
 *
 * @see BUSINESS_RULES.md §3 — Role matrix
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  [SYSTEM_ROLES.OWNER]: [
    'platform:organization:delete',
    'platform:ownership:transfer',
    'platform:billing:manage',
    'platform:modules:enable',
    'platform:modules:disable',
    'platform:members:invite',
    'platform:members:remove',
    'platform:members:assign-role',
    'platform:roles:manage',
    'platform:settings:manage',
    'platform:audit:view',
    'platform:module:configure',
    'platform:data:write',
    'platform:data:read',
    'platform:data:export',
    ...ALL_MODULES,
  ],
  [SYSTEM_ROLES.ADMIN]: [
    'platform:billing:manage',
    'platform:modules:enable',
    'platform:modules:disable',
    'platform:members:invite',
    'platform:members:remove',
    'platform:members:assign-role',
    'platform:roles:manage',
    'platform:settings:manage',
    'platform:audit:view',
    'platform:module:configure',
    'platform:data:write',
    'platform:data:read',
    'platform:data:export',
    ...ALL_MODULES,
  ],
  [SYSTEM_ROLES.MANAGER]: [
    'platform:module:configure',
    'platform:data:write',
    'platform:data:read',
    'platform:data:export',
    ...ALL_MODULES,
  ],
  [SYSTEM_ROLES.MEMBER]: ['platform:data:write', 'platform:data:read', ...MODULE_DATA_READ, ...MODULE_DATA_WRITE],
  [SYSTEM_ROLES.VIEWER]: ['platform:data:read', ...MODULE_DATA_READ],
};

/**
 * Seed metadata (name + description) for the five system roles.
 *
 * Org creation inserts one `core_roles` row per system role so every
 * organization starts with the full documented role set — the members
 * page invite/role dropdowns read these rows. System-role *permissions*
 * stay code-defined (`SYSTEM_ROLE_PERMISSIONS`); only the role rows are
 * persisted per org (AUTH-10).
 *
 * @see BUSINESS_RULES.md §3 — Role matrix
 */
export const SYSTEM_ROLE_SEED: Record<SystemRoleKey, { nameI18n: Record<string, string>; description: string }> = {
  [SYSTEM_ROLES.OWNER]: {
    nameI18n: { en: 'Owner', ar: 'المالك', fr: 'Propriétaire', es: 'Propietario' },
    description: 'Organization owner with full administrative access.',
  },
  [SYSTEM_ROLES.ADMIN]: {
    nameI18n: { en: 'Admin', ar: 'مدير', fr: 'Administrateur', es: 'Administrador' },
    description: 'Administrator with platform-level management rights.',
  },
  [SYSTEM_ROLES.MANAGER]: {
    nameI18n: { en: 'Manager', ar: 'مشرف', fr: 'Gestionnaire', es: 'Gerente' },
    description: 'Manages module configuration and data.',
  },
  [SYSTEM_ROLES.MEMBER]: {
    nameI18n: { en: 'Member', ar: 'عضو', fr: 'Membre', es: 'Miembro' },
    description: 'Standard member with data read/write access.',
  },
  [SYSTEM_ROLES.VIEWER]: {
    nameI18n: { en: 'Viewer', ar: 'مشاهد', fr: 'Observateur', es: 'Observador' },
    description: 'Read-only access to module data.',
  },
};

/**
 * Role entity data (persisted to core_roles).
 */
export interface RoleData {
  id: string;
  organizationId: string;
  key: string;
  nameI18n: Record<string, string>;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

/**
 * Role permission link data (persisted to core_role_permissions).
 */
export interface RolePermissionData {
  id: string;
  organizationId: string;
  roleId: string;
  permissionKey: string;
  createdAt: Date;
  createdBy: string | null;
}

/**
 * Role — domain entity for RBAC roles.
 *
 * Business rules enforced:
 * - AUTHZ-4: Custom roles may never include platform-admin permissions
 * - System roles cannot be renamed or deleted
 * - Role keys are unique per organization
 */
export class Role {
  private constructor(private readonly data: RoleData) {}

  static create(data: RoleData): Role {
    return new Role(data);
  }

  static fromPersistence(data: RoleData): Role {
    return new Role(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get key(): string {
    return this.data.key;
  }
  get nameI18n(): Record<string, string> {
    return { ...this.data.nameI18n };
  }
  get description(): string | null {
    return this.data.description;
  }
  get isSystem(): boolean {
    return this.data.isSystem;
  }
  get isDeletable(): boolean {
    return !this.data.isSystem && this.data.deletedAt === null;
  }
  get createdAt(): Date {
    return this.data.createdAt;
  }
  get updatedAt(): Date {
    return this.data.updatedAt;
  }
  get deletedAt(): Date | null {
    return this.data.deletedAt;
  }

  /** Check if this is an OWNER role. */
  get isOwnerRole(): boolean {
    return this.data.key === SYSTEM_ROLES.OWNER;
  }

  toJSON(): RoleData {
    return { ...this.data };
  }

  // ─── Behaviour ─────────────────────────────────────────────────────────

  /**
   * Update role metadata (name, description).
   * System roles cannot be renamed (only description can change).
   */
  update(data: { nameI18n?: Record<string, string>; description?: string | null }, updatedBy?: string): void {
    if (data.nameI18n && this.data.isSystem) {
      throw new RoleError(SYSTEM_ROLE_IMMUTABLE, 'System roles cannot be renamed');
    }

    if (data.nameI18n) this.data.nameI18n = { ...data.nameI18n };
    if (data.description !== undefined) this.data.description = data.description;
    if (updatedBy) this.data.updatedBy = updatedBy;
  }

  /**
   * Soft-delete the role.
   * System roles and the last OWNER role cannot be deleted.
   */
  delete(isLastOwnerRole: boolean, updatedBy?: string): void {
    if (this.data.isSystem) {
      throw new RoleError(SYSTEM_ROLE_IMMUTABLE, 'System roles cannot be deleted');
    }
    if (isLastOwnerRole) {
      throw new RoleError(LAST_OWNER_ROLE, 'Cannot delete the last owner role');
    }

    this.data.deletedAt = new Date();
    this.data.updatedBy = updatedBy ?? null;
  }

  /**
   * Validate custom role permissions (AUTHZ-4).
   * Custom roles may never include platform-admin permissions.
   */
  static validateCustomPermissions(permissionKeys: string[]): void {
    const platformPerms = PLATFORM_PERMISSIONS as readonly string[];
    const denied = permissionKeys.filter((k) => platformPerms.includes(k));
    if (denied.length > 0) {
      throw new RoleError(
        CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED,
        `Custom roles cannot include platform permissions: ${denied.join(', ')}`,
      );
    }
  }
}

/**
 * Role-specific domain error.
 */
export class RoleError extends DomainError {
  constructor(
    override readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RoleError';
  }
}
