import { MODULE_KEYS } from '@modubiz/contracts';
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import {
  CreateContactUseCase,
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
  ) {}

  @Get()
  @ApiOkResponse({ type: ContactListEnvelopeResponse })
  @RequiresPermission('crm:contact:read')
  async list(
    @Query('search') search?: string,
    @Query('companyId') companyId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    const result = await this.listContactsUseCase.execute({
      ...(search !== undefined ? { search } : {}),
      ...(companyId !== undefined ? { companyId } : {}),
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
    return { data: await this.getContactUseCase.execute(id) };
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
    const result = await this.createContactUseCase.execute({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      secondaryPhone: dto.secondaryPhone ?? null,
      companyId: dto.companyId ?? null,
      ownerUserId: dto.ownerUserId ?? null,
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
  @Audit({ action: 'UPDATE', entityType: 'contact', captureAfter: true })
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
    preferredLocale: data.preferredLocale,
    preferredCurrency: data.preferredCurrency,
  };
}
