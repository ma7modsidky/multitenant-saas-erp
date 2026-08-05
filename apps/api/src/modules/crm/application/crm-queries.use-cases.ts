import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import {
  CRM_READ_REPOSITORY,
  type ActivityListFilter,
  type ContactListFilter,
  type CompanyListFilter,
  type CrmCompanyRecord,
  type CrmReadRepository,
  type DealListFilter,
  type DealListPage,
  type PageResult,
} from './ports/index.js';

@Injectable()
export class ListContactsUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  execute(filter: ContactListFilter = {}): Promise<PageResult<Record<string, unknown>>> {
    return this.tx.run((db) => this.repo.listContacts(filter, db));
  }
}

@Injectable()
export class ListCompaniesUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  execute(filter: CompanyListFilter = {}): Promise<PageResult<CrmCompanyRecord>> {
    return this.tx.run((db) => this.repo.listCompanies(filter, db));
  }
}

@Injectable()
export class GetContactUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  async execute(id: string): Promise<Record<string, unknown>> {
    const result = await this.tx.run((db) => this.repo.findContactById(id, db));
    if (!result) throw new NotFoundError('CONTACT_NOT_FOUND', { contactId: id });
    return result;
  }
}

@Injectable()
export class GetCompanyUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  async execute(id: string): Promise<CrmCompanyRecord> {
    const result = await this.tx.run((db) => this.repo.findCompanyById(id, db));
    if (!result) throw new NotFoundError('COMPANY_NOT_FOUND', { companyId: id });
    return result;
  }
}

@Injectable()
export class GetDealUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  async execute(id: string): Promise<Record<string, unknown>> {
    const result = await this.tx.run((db) => this.repo.findDealById(id, db));
    if (!result) throw new NotFoundError('DEAL_NOT_FOUND', { dealId: id });
    return result;
  }
}

@Injectable()
export class GetActivityUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  async execute(id: string): Promise<Record<string, unknown>> {
    const result = await this.tx.run((db) => this.repo.findActivityById(id, db));
    if (!result) throw new NotFoundError('ACTIVITY_NOT_FOUND', { activityId: id });
    return result;
  }
}

@Injectable()
export class ListDealsUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  execute(filter: DealListFilter = {}): Promise<DealListPage> {
    return this.tx.run((db) => this.repo.listDeals(filter, db));
  }
}

@Injectable()
export class ListActivitiesUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  execute(filter: ActivityListFilter = {}): Promise<PageResult<Record<string, unknown>>> {
    return this.tx.run((db) => this.repo.listActivities(filter, db));
  }
}

@Injectable()
export class GetPipelineBoardUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  execute() {
    return this.tx.run((db) => this.repo.getDefaultPipeline(db));
  }
}

@Injectable()
export class CreateCompanyUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  execute(input: Omit<CrmCompanyRecord, 'id'>) {
    const organizationId = TenantContext.requireOrganizationId();
    // Audit stamps: the creating session user, mirroring the domain entities
    // of contacts/deals/activities.
    const userId = TenantContext.getUserId() ?? null;
    const stamp = { createdByUserId: userId, updatedByUserId: userId };
    return this.tx.run((db) =>
      this.repo.insertCompany({ ...input, ...stamp, id: crypto.randomUUID(), organizationId }, db),
    );
  }
}

@Injectable()
export class UpdateCompanyUseCase {
  constructor(
    @Inject(CRM_READ_REPOSITORY) private readonly repo: CrmReadRepository,
    private readonly tx: TransactionManager,
  ) {}
  async execute(id: string, input: Partial<CrmCompanyRecord>) {
    // Audit stamp: who made this edit.
    const userId = TenantContext.getUserId() ?? null;
    const result = await this.tx.run((db) => this.repo.updateCompany(id, { ...input, updatedByUserId: userId }, db));
    if (!result) throw new NotFoundError('COMPANY_NOT_FOUND', { companyId: id });
    return result;
  }
}
