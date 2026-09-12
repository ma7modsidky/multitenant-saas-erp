import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import {
  CONTACT_REPOSITORY,
  CRM_READ_REPOSITORY,
  DEAL_REPOSITORY,
  type ContactRepository,
  type CrmReadRepository,
  type DealRepository,
} from './ports/index.js';

export interface DeleteCompanyInput {
  companyId: string;
}

/**
 * DeleteCompanyUseCase — CRM-15: deleting a company soft-deletes it, detaches
 * its contacts (`company_id = NULL`), and detaches its open deals; closed
 * (won/lost) deals keep their historical attribution. Contacts themselves are
 * never deleted by a company deletion.
 *
 * The audit entry is written via the API layer's @Audit interceptor (AUD-1)
 * with a pre-mutation snapshot — the recovery path, as with contact deletions.
 */
@Injectable()
export class DeleteCompanyUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY)
    private readonly readRepo: CrmReadRepository,
    @Inject(CONTACT_REPOSITORY)
    private readonly contactRepo: ContactRepository,
    @Inject(DEAL_REPOSITORY)
    private readonly dealRepo: DealRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: DeleteCompanyInput): Promise<void> {
    await this.txManager.run(async (tx) => {
      const company = await this.readRepo.findCompanyById(input.companyId, tx);
      if (!company) {
        throw new NotFoundError('COMPANY_NOT_FOUND', { companyId: input.companyId });
      }

      // CRM-15: detach first, then soft-delete.
      await this.contactRepo.detachCompany(input.companyId, tx);
      await this.dealRepo.detachCompany(input.companyId, tx);
      await this.readRepo.softDeleteCompany(input.companyId, tx);
    });
  }
}
