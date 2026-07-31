import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Role, ROLE_KEY_EXISTS } from '../domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../ports/index.js';

@Injectable()
export class CreateRoleUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    organizationId: string;
    key: string;
    nameI18n: Record<string, string>;
    description?: string;
    permissionKeys?: string[];
    createdBy: string;
  }): Promise<{ id: string }> {
    const normalizedKey = input.key.trim().toLowerCase().replace(/\s+/g, '_');

    // Check for duplicate key
    const existing = await this.roleRepo.findByKey(input.organizationId, normalizedKey);
    if (existing) {
      throw new ConflictError(ROLE_KEY_EXISTS, `Role with key '${normalizedKey}' already exists`);
    }

    // AUTHZ-4: Custom roles may never include platform-admin permissions
    const perms = input.permissionKeys ?? [];
    Role.validateCustomPermissions(perms);

    const roleId = crypto.randomUUID();

    await this.txManager.run(async (tx) => {
      await this.roleRepo.insert({
        id: roleId,
        organizationId: input.organizationId,
        key: normalizedKey,
        nameI18n: input.nameI18n,
        description: input.description ?? null,
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        deletedAt: null,
      }, tx);

      // Set permissions if provided
      if (perms.length > 0) {
        await this.roleRepo.setPermissions(roleId, perms, input.createdBy, tx);
      }
    });

    return { id: roleId };
  }
}
