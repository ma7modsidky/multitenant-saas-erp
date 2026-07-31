import { DomainError } from '../../../core/common/errors.js';
import {
  SYSTEM_ROLE_IMMUTABLE,
  LAST_OWNER_ROLE,
  CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED,
} from './errors.js';

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
  'platform:roles:manage',
  'platform:settings:manage',
  'platform:audit:view',
] as const;

/**
 * The built-in role-to-permission matrix for system roles.
 * Maps each system role key to its granted permissions.
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
    'platform:roles:manage',
    'platform:settings:manage',
    'platform:audit:view',
    'platform:module:configure',
    'platform:data:write',
    'platform:data:read',
    'platform:data:export',
  ],
  [SYSTEM_ROLES.ADMIN]: [
    'platform:billing:manage',
    'platform:modules:enable',
    'platform:modules:disable',
    'platform:members:invite',
    'platform:members:remove',
    'platform:roles:manage',
    'platform:settings:manage',
    'platform:audit:view',
    'platform:module:configure',
    'platform:data:write',
    'platform:data:read',
    'platform:data:export',
  ],
  [SYSTEM_ROLES.MANAGER]: [
    'platform:module:configure',
    'platform:data:write',
    'platform:data:read',
    'platform:data:export',
  ],
  [SYSTEM_ROLES.MEMBER]: [
    'platform:data:write',
    'platform:data:read',
  ],
  [SYSTEM_ROLES.VIEWER]: [
    'platform:data:read',
  ],
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

  get id(): string { return this.data.id; }
  get organizationId(): string { return this.data.organizationId; }
  get key(): string { return this.data.key; }
  get nameI18n(): Record<string, string> { return { ...this.data.nameI18n }; }
  get description(): string | null { return this.data.description; }
  get isSystem(): boolean { return this.data.isSystem; }
  get isDeletable(): boolean { return !this.data.isSystem && this.data.deletedAt === null; }
  get createdAt(): Date { return this.data.createdAt; }
  get updatedAt(): Date { return this.data.updatedAt; }
  get deletedAt(): Date | null { return this.data.deletedAt; }

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
