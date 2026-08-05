import { MODULE_KEYS } from '@modubiz/contracts';
import { Body, Controller, Get, Inject, Param, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { NOTE_REPOSITORY, type NoteData, type NoteRepository } from '../application/ports/index.js';

import { createNoteSchema, CreateNoteDto, NoteListEnvelopeResponse, NoteEnvelopeResponse } from './dto/index.js';

/**
 * NotesController — free-text notes on contacts, companies, deals, activities
 * (`/v1/crm/notes`).
 *
 * Notes are append-only (no edit, no delete) — the ledger philosophy.
 * Anyone with `crm:contact:write` (or the relevant entity write permission)
 * can add a note. The note records `created_by` from the session.
 */
@Controller('v1/crm/notes')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.CRM)
export class NotesController {
  constructor(
    @Inject(NOTE_REPOSITORY)
    private readonly noteRepo: NoteRepository,
    private readonly txManager: TransactionManager,
  ) {}

  /**
   * POST /v1/crm/notes — create a note attached to a contact, company, deal,
   * or activity.
   *
   * Runs inside TransactionManager.run() so that SET LOCAL sets the
   * app.current_organization_id GUC, which RLS requires to scope the INSERT.
   */
  @Post()
  @ApiCreatedResponse({ type: NoteEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createNoteSchema))
  @RequiresPermission('crm:contact:write')
  async create(@Body() dto: CreateNoteDto): Promise<{ data: Record<string, unknown> }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();
    const note: NoteData = {
      id: crypto.randomUUID(),
      organizationId,
      body: dto.body,
      relatedType: dto.relatedType,
      relatedId: dto.relatedId,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    };
    const persisted = await this.txManager.run(async (tx) => this.noteRepo.insert(note, tx));
    return { data: toNoteResponse(persisted) };
  }

  /**
   * GET /v1/crm/notes/:relatedType/:relatedId — list notes attached to an
   * entity, newest first.
   *
   * E.g. GET /v1/crm/notes/contact/abc-123
   */
  @Get(':relatedType/:relatedId')
  @ApiOkResponse({ type: NoteListEnvelopeResponse })
  @RequiresPermission('crm:contact:read')
  async listByRelated(
    @Param('relatedType') relatedType: string,
    @Param('relatedId') relatedId: string,
  ): Promise<{ data: { items: Record<string, unknown>[] } }> {
    const notes = await this.txManager.run((tx) => this.noteRepo.listByRelated(relatedType, relatedId, tx));
    return { data: { items: notes.map(toNoteResponse) } };
  }
}

// ─── Response mapper ─────────────────────────────────────────────────────────

function toNoteResponse(data: NoteData): Record<string, unknown> {
  return {
    id: data.id,
    body: data.body,
    relatedType: data.relatedType,
    relatedId: data.relatedId,
    createdAt: data.createdAt.toISOString(),
    updatedAt: data.updatedAt.toISOString(),
    createdByUserId: data.createdBy,
    createdByName: data.createdByName ?? null,
  };
}
