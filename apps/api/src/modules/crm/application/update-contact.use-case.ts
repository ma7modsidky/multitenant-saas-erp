import { CRM_EVENTS, type CrmContactUpdatedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Contact } from '../domain/index.js';

import { CONTACT_REPOSITORY, type ContactRepository } from './ports/index.js';

export interface UpdateContactInput {
  contactId: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  secondaryPhone?: string | null;
  companyId?: string | null;
  ownerUserId?: string | null;
  preferredLocale?: string | null;
  preferredCurrency?: string | null;
}

/**
 * UpdateContactUseCase — updates a CRM contact. Owns its transaction.
 *
 * Business rules:
 * - CRM-1: re-validated by the domain against the resulting identity.
 * - CRM-2: a duplicate email (by another non-deleted contact) is rejected.
 *
 * Collects `crm.contact.updated.v1`; caller publishes after commit.
 */
@Injectable()
export class UpdateContactUseCase {
  constructor(
    @Inject(CONTACT_REPOSITORY)
    private readonly contactRepo: ContactRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: UpdateContactInput): Promise<{ contact: Contact }> {
    const userId = TenantContext.getUserId() ?? null;

    const committed = await this.txManager.run(async (tx) => {
      const existing = await this.contactRepo.findById(input.contactId, tx);
      if (!existing) {
        throw new NotFoundError('CONTACT_NOT_FOUND', { contactId: input.contactId });
      }

      const contact = Contact.fromPersistence(existing);
      // exactOptionalPropertyTypes: optional props must be ABSENT, never
      // `undefined` — build the update object conditionally.
      const updateProps: {
        firstName?: string;
        lastName?: string;
        email?: string | null;
        phone?: string | null;
        secondaryPhone?: string | null;
        companyId?: string | null;
        ownerUserId?: string | null;
        preferredLocale?: string | null;
        preferredCurrency?: string | null;
      } = {};
      if (input.firstName !== undefined) updateProps.firstName = input.firstName;
      if (input.lastName !== undefined) updateProps.lastName = input.lastName;
      if (input.email !== undefined) updateProps.email = input.email;
      if (input.secondaryPhone !== undefined) updateProps.secondaryPhone = input.secondaryPhone;
      if (input.phone !== undefined) updateProps.phone = input.phone;
      if (input.companyId !== undefined) updateProps.companyId = input.companyId;
      if (input.ownerUserId !== undefined) updateProps.ownerUserId = input.ownerUserId;
      if (input.preferredLocale !== undefined) updateProps.preferredLocale = input.preferredLocale;
      if (input.preferredCurrency !== undefined) updateProps.preferredCurrency = input.preferredCurrency;
      contact.update({ ...updateProps, updatedBy: userId ?? 'system' });

      // CRM-2: a NEW email must not collide with another non-deleted contact.
      const newEmail = input.email === undefined ? existing.email : input.email;
      if (newEmail !== null) {
        const other = await this.contactRepo.findByEmail(newEmail, tx);
        if (other && other.id !== input.contactId) {
          contact.assertEmailUniqueIn(new Set([other.email ?? '']));
        }
      }

      const updated = await this.contactRepo.update(input.contactId, contact.toJSON(), tx);
      if (!updated) {
        throw new NotFoundError('CONTACT_NOT_FOUND', { contactId: input.contactId });
      }

      const payload: CrmContactUpdatedV1 = {
        organizationId: updated.organizationId,
        contactId: updated.id,
        companyId: updated.companyId,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        phone: updated.phone,
        secondaryPhone: updated.secondaryPhone,
        ownerUserId: updated.ownerUserId,
        occurredAt: new Date().toISOString(),
      };
      const event = {
        name: CRM_EVENTS.CONTACT_UPDATED_V1,
        payload,
        aggregateId: updated.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { result: { contact: Contact.fromPersistence(updated) }, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return committed.result;
  }
}
