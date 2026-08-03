import { CRM_EVENTS, type CrmContactCreatedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Contact } from '../domain/index.js';

import { CONTACT_REPOSITORY, type ContactRepository } from './ports/index.js';

export interface CreateContactInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  companyId?: string | null;
  ownerUserId?: string | null;
  preferredLocale?: string | null;
  preferredCurrency?: string | null;
}

/**
 * CreateContactUseCase — creates a CRM contact. Owns its transaction.
 *
 * Business rules:
 * - CRM-1: requires at least one of email or phone (domain invariant).
 * - CRM-2: contact email is unique per organization among non-deleted contacts
 *   (`CRM_CONTACT_DUPLICATE_EMAIL`).
 *
 * Collects `crm.contact.created.v1`; the caller publishes events AFTER commit
 * (TransactionManager does not auto-publish — use case calls publishEvents()).
 */
@Injectable()
export class CreateContactUseCase {
  constructor(
    @Inject(CONTACT_REPOSITORY)
    private readonly contactRepo: ContactRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: CreateContactInput): Promise<{ contact: Contact }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const contact = Contact.create({
      id: crypto.randomUUID(),
      organizationId,
      companyId: input.companyId ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      ownerUserId: input.ownerUserId ?? null,
      preferredLocale: input.preferredLocale ?? null,
      preferredCurrency: input.preferredCurrency ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    });

    const result = await this.txManager.run(async (tx) => {
      // CRM-2: reject a duplicate email within the org (RLS-scoped read).
      const existing = await this.contactRepo.findByEmail(contact.email ?? '', tx);
      if (existing) {
        contact.assertEmailUniqueIn(new Set([existing.email ?? '']));
      }

      const persisted = await this.contactRepo.insert(contact.toJSON(), tx);

      const payload: CrmContactCreatedV1 = {
        organizationId,
        contactId: persisted.id,
        companyId: persisted.companyId,
        firstName: persisted.firstName,
        lastName: persisted.lastName,
        email: persisted.email,
        phone: persisted.phone,
        ownerUserId: persisted.ownerUserId ?? '',
        occurredAt: new Date().toISOString(),
      };
      this.unitOfWork.addEvent({
        name: CRM_EVENTS.CONTACT_CREATED_V1,
        payload,
        aggregateId: persisted.id,
      });

      return { contact: Contact.fromPersistence(persisted) };
    });

    // Events are published after the transaction commits (never before).
    await this.unitOfWork.publishEvents();
    return result;
  }
}
