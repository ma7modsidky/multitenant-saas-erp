import { Module } from '@nestjs/common';

import { ActivitiesController, ContactsController, DealsController } from './api/index.js';
import {
  CloseDealUseCase,
  CompleteActivityUseCase,
  CreateActivityUseCase,
  CreateContactUseCase,
  CreateDealUseCase,
  EnsureDefaultPipelineUseCase,
  MergeContactsUseCase,
  MoveDealStageUseCase,
  ReopenDealUseCase,
  UpdateContactUseCase,
} from './application/index.js';
import {
  ACTIVITY_REPOSITORY,
  ATTACHMENT_REPOSITORY,
  CONTACT_REPOSITORY,
  DEAL_REPOSITORY,
  NOTE_REPOSITORY,
  PIPELINE_REPOSITORY,
} from './application/ports/index.js';
import {
  DrizzleActivityRepository,
  DrizzleAttachmentRepository,
  DrizzleContactRepository,
  DrizzleDealRepository,
  DrizzleNoteRepository,
  DrizzlePipelineRepository,
} from './infrastructure/index.js';

/**
 * CrmModule — Nest composition of the crm bounded context.
 *
 * Repositories are bound to their port tokens; use cases depend only on the
 * ports. The API layer (Step 4.6) adds controllers + @Audit wiring.
 *
 * @see MODULE_GUIDE.md §3 — Canonical folder skeleton
 */
@Module({
  controllers: [ContactsController, DealsController, ActivitiesController],
  providers: [
    // Repositories (infrastructure) bound to port tokens.
    { provide: CONTACT_REPOSITORY, useClass: DrizzleContactRepository },
    { provide: PIPELINE_REPOSITORY, useClass: DrizzlePipelineRepository },
    { provide: DEAL_REPOSITORY, useClass: DrizzleDealRepository },
    { provide: ACTIVITY_REPOSITORY, useClass: DrizzleActivityRepository },
    { provide: NOTE_REPOSITORY, useClass: DrizzleNoteRepository },
    { provide: ATTACHMENT_REPOSITORY, useClass: DrizzleAttachmentRepository },
    // Use cases (application).
    EnsureDefaultPipelineUseCase,
    CreateContactUseCase,
    UpdateContactUseCase,
    MergeContactsUseCase,
    CreateDealUseCase,
    MoveDealStageUseCase,
    CloseDealUseCase,
    ReopenDealUseCase,
    CreateActivityUseCase,
    CompleteActivityUseCase,
  ],
})
export class CrmModule {}
