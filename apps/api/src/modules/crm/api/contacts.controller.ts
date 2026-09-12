import { MODULE_KEYS } from '@modubiz/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import {
  assertCanViewRecord,
  assertOwnershipChange,
  parseCrmScope,
  resolveOwnershipDefaults,
  resolveScopeFilter,
} from './scope.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  CreateContactUseCase,
  DeleteContactUseCase,
  GetContactUseCase,
  ListContactsUseCase,
  MergeContactsUseCase,
  UpdateContactUseCase,
} from '../application/index.js';

import {
  ContactEnvelopeResponse,
  ContactListEnvelopeResponse,
  CreateContactDto,
  MergeContactsDto,
  MergeEnvelopeResponse,
  UpdateContactDto,
  createContactSchema,
  mergeContactsSchema,
  updateContactSchema,
} from './dto/index.js';

/**
 * ContactsController — contact endpoints of the crm bounded context
 * (`/v1/crm/contacts`).
 *
 * All routes require JWT auth + the `crm` module entitlement (AUTHZ-6) +
 * `crm:contact:write`. Controllers validate, delegate to a use case, and map
 * the response — no business logic (hard rule #6).
 *
 * @see CRM-1 (identity), CRM-2 (duplicate email), CRM-12 (merge)
 */
@Controller('v1/crm/contacts')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.CRM)
export class ContactsController {
  constructor(
    private readonly listContactsUseCase: ListContactsUseCase,
    private readonly getContactUseCase: GetContactUseCase,
    private readonly createContactUseCase: CreateContactUseCase,
    private readonly updateContactUseCase: UpdateContactUseCase,
    private readonly mergeContactsUseCase: MergeContactsUseCase,
    private readonly deleteContactUseCase: DeleteContactUseCase,
    private readonly portRegistry: PortRegistry,
  ) {}

  @Get()
  @ApiOkResponse({ type: ContactListEnvelopeResponse })
  @RequiresPermission('crm:contact:read')
  async list(
    @Query('search') search?: string,
    @Query('companyId') companyId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('unassigned') unassigned?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('scope') scope?: string,
    @Query('pool') pool?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    // Query params are interpolated into SQL below, so every one must be
    // validated here — a malformed value would otherwise surface as a 500
    // instead of a 400 (ERR-1/ERR-6).
    if (
      sortBy !== undefined &&
      sortBy !== 'updatedAt' &&
      sortBy !== 'createdAt' &&
      sortBy !== 'name' &&
      sortBy !== 'email'
    ) {
      throw new BadRequestException('sortBy must be one of updatedAt, createdAt, name, email');
    }
    if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') {
      throw new BadRequestException('sortDir must be asc or desc');
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (ownerUserId !== undefined && !uuid.test(ownerUserId)) {
      throw new BadRequestException('ownerUserId must be a valid UUID');
    }
    // unassigned is a boolean-ish query flag — anything other than
    // `true`/`false` is malformed input (400), never a 500.
    let unassignedFlag: boolean | undefined;
    if (unassigned !== undefined) {
      if (unassigned !== 'true' && unassigned !== 'false') {
        throw new BadRequestException('unassigned must be true or false');
      }
      unassignedFlag = unassigned === 'true';
    }
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if (createdFrom !== undefined && !isoDate.test(createdFrom)) {
      throw new BadRequestException('createdFrom must be an ISO date (YYYY-MM-DD)');
    }
    // TEAM-4 pool view: `team` = assigned to a team but no individual owner;
    // `global` = no owner and no team. Anything else is malformed (400).
    let poolFilter: 'team' | 'global' | undefined;
    if (pool !== undefined) {
      if (pool !== 'team' && pool !== 'global') {
        throw new BadRequestException('pool must be team or global');
      }
      poolFilter = pool;
    }
    // AUTHZ-9/10: scope is always enforced. When omitted we treat it as
    // 'all' and clamp to the caller's ceiling (member → own+pool,
    // leader → team, admin → global), so an unscoped request never leaks
    // cross-team data.
    const effectiveScope = parseCrmScope(scope) ?? 'all';
    const scopeFilter = await resolveScopeFilter(effectiveScope, this.portRegistry);
    const result = await this.listContactsUseCase.execute({
      ...(search !== undefined ? { search } : {}),
      ...(companyId !== undefined ? { companyId } : {}),
      ...(ownerUserId !== undefined ? { ownerUserId } : {}),
      ...(unassignedFlag !== undefined ? { unassigned: unassignedFlag } : {}),
      ...(poolFilter !== undefined ? { pool: poolFilter } : {}),
      ...(createdFrom !== undefined ? { createdFrom } : {}),
      ...(scopeFilter ?? {}),
      ...(sortBy !== undefined ? { sortBy } : {}),
      ...(sortDir !== undefined ? { sortDir } : {}),
      ...(page !== undefined ? { page: Number(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: Number(pageSize) } : {}),
    });
    return { data: result };
  }

  /**
   * GET /v1/crm/contacts/:id — contact detail.
   */
  @Get(':id')
  @ApiOkResponse({ type: ContactEnvelopeResponse })
  @RequiresPermission('crm:contact:read')
  async getById(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const data = await this.getContactUseCase.execute(id);
    await assertCanViewRecord(this.portRegistry, data);
    return { data };
  }

  /**
   * POST /v1/crm/contacts — create a contact (CRM-1/CRM-2).
   */
  @Post()
  @ApiCreatedResponse({ type: ContactEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createContactSchema))
  @RequiresPermission('crm:contact:write')
  @Audit({ action: 'CREATE', entityType: 'contact', captureAfter: true })
  async create(@Body() dto: CreateContactDto): Promise<{ data: Record<string, unknown> }> {
    // TEAM-2: default owner_user_id to the creating user and owner_team_id
    // to their primary team when not explicitly provided.
    const ownership = await resolveOwnershipDefaults(this.portRegistry, {
      ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
      ...(dto.ownerTeamId !== undefined ? { ownerTeamId: dto.ownerTeamId } : {}),
    });
    const result = await this.createContactUseCase.execute({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      secondaryPhone: dto.secondaryPhone ?? null,
      companyId: dto.companyId ?? null,
      ownerUserId: ownership.ownerUserId,
      ownerTeamId: ownership.ownerTeamId,
      preferredLocale: dto.preferredLocale ?? null,
      preferredCurrency: dto.preferredCurrency ?? null,
    });
    return { data: toContactResponse(result.contact.toJSON()) };
  }

  /**
   * PATCH /v1/crm/contacts/:id — update a contact (CRM-1/CRM-2 re-validated).
   */
  @Patch(':id')
  @ApiOkResponse({ type: ContactEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(updateContactSchema))
  @RequiresPermission('crm:contact:write')
  @Audit({ action: 'UPDATE', entityType: 'contact', captureAfter: true, captureBefore: true })
  async update(@Param('id') id: string, @Body() dto: UpdateContactDto): Promise<{ data: Record<string, unknown> }> {
    // exactOptionalPropertyTypes: optional props must be ABSENT, never
    // `undefined` — build the input object conditionally.
    const input: {
      contactId: string;
      firstName?: string;
      lastName?: string;
      email?: string | null;
      phone?: string | null;
      secondaryPhone?: string | null;
      companyId?: string | null;
      ownerUserId?: string | null;
      ownerTeamId?: string | null;
      preferredLocale?: string | null;
      preferredCurrency?: string | null;
    } = { contactId: id };
    if (dto.firstName !== undefined) input.firstName = dto.firstName;
    if (dto.lastName !== undefined) input.lastName = dto.lastName;
    if (dto.email !== undefined) input.email = dto.email;
    if (dto.phone !== undefined) input.phone = dto.phone;
    if (dto.secondaryPhone !== undefined) input.secondaryPhone = dto.secondaryPhone;
    if (dto.companyId !== undefined) input.companyId = dto.companyId;
    if (dto.ownerUserId !== undefined) input.ownerUserId = dto.ownerUserId;
    if (dto.ownerTeamId !== undefined) input.ownerTeamId = dto.ownerTeamId;
    // AUTHZ-9/TEAM-6: fail-closed visibility on every mutation — a record the
    // actor cannot view behaves as nonexistent, exactly like GET /:id.
    const current = await this.getContactUseCase.execute(id);
    await assertCanViewRecord(this.portRegistry, current);
    // CRM-16: ownership transitions are role-scoped (claim / leader / admin).
    if (dto.ownerUserId !== undefined || dto.ownerTeamId !== undefined) {
      await assertOwnershipChange(this.portRegistry, {
        organizationId: TenantContext.requireOrganizationId(),
        actorUserId: TenantContext.requireUserId(),
        currentOwnerUserId: (current.ownerUserId as string | null) ?? null,
        currentOwnerTeamId: (current.ownerTeamId as string | null) ?? null,
        nextOwnerUserId: dto.ownerUserId,
        nextOwnerTeamId: dto.ownerTeamId,
      });
    }
    if (dto.preferredLocale !== undefined) input.preferredLocale = dto.preferredLocale;
    if (dto.preferredCurrency !== undefined) input.preferredCurrency = dto.preferredCurrency;

    const result = await this.updateContactUseCase.execute(input);
    return { data: toContactResponse(result.contact.toJSON()) };
  }

  /**
   * POST /v1/crm/contacts/merge — merge source into target (CRM-12).
   */
  @Post('merge')
  @ApiOkResponse({ type: MergeEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(mergeContactsSchema))
  @RequiresPermission('crm:contact:write')
  @Audit({ action: 'UPDATE', entityType: 'contact' })
  async merge(@Body() dto: MergeContactsDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.mergeContactsUseCase.execute({
      sourceContactId: dto.sourceContactId,
      targetContactId: dto.targetContactId,
    });
    return { data: toContactResponse(result.target.toJSON()) };
  }

  /**
   * DELETE /v1/crm/contacts/:id — soft-delete a contact (CRM-11).
   *
   * Gated by `crm:contact:write` like the other destructive-but-reversible
   * mutations (merge); the soft delete is restorable within the retention
   * window (DATA_MODEL §14), so no dedicated `delete` action exists.
   */
  @Delete(':id')
  @ApiNoContentResponse()
  @RequiresPermission('crm:contact:write')
  @Audit({ action: 'DELETE', entityType: 'contact', captureBefore: true })
  async delete(@Param('id') id: string): Promise<void> {
    const data = await this.getContactUseCase.execute(id);
    await assertCanViewRecord(this.portRegistry, data);
    await this.deleteContactUseCase.execute({ contactId: id });
  }
}

// ─── Response mapper ─────────────────────────────────────────────────────────
//
// Controllers map domain entities to the wire shape; the zod response schemas
// (and OpenAPI) describe exactly what leaves the API.

function toContactResponse(data: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  companyId: string | null;
  ownerUserId: string | null;
  ownerTeamId?: string | null;
  preferredLocale: string | null;
  preferredCurrency: string | null;
}): Record<string, unknown> {
  return {
    id: data.id,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    phone: data.phone,
    secondaryPhone: data.secondaryPhone,
    companyId: data.companyId,
    ownerUserId: data.ownerUserId,
    ownerTeamId: data.ownerTeamId,
    preferredLocale: data.preferredLocale,
    preferredCurrency: data.preferredCurrency,
  };
}
