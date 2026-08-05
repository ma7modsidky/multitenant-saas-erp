/**
 * CRM application-layer integration tests — real Postgres, RLS active.
 *
 * Exercises the use cases end-to-end against the real CRM schema
 * (apps/api/src/modules/crm/db/migrations) with the `modubiz_app` role:
 *   - CRM-3: the first deal write lazily ensures exactly one default pipeline;
 *     a second call is a no-op.
 *   - CRM-6: every stage change appends a row to crm_deal_stage_history.
 *   - CRM-8: a deal value in a non-base currency stores the FX rate snapshot
 *     (exchange_rate + base_amount_minor) at write time.
 *   - CRM-12: merge moves activities, notes, deals, and attachments to the
 *     surviving contact and soft-deletes the source.
 *   - OPS-3/CRM-9: `crm.deal.won.v1` is published only after commit — a
 *     rolled-back move publishes nothing.
 *
 * @see PLAN.md §4.5 — Application layer (tests)
 * @see AGENTS.md §9 — Definition of done (integration tests)
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

import { Money, type FxRate } from '../../packages/money/src/money.js';
import { TransactionManager } from '../../apps/api/src/core/database/transaction-manager.js';
import { UnitOfWork } from '../../apps/api/src/core/database/unit-of-work.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import { DrizzleContactRepository } from '../../apps/api/src/modules/crm/infrastructure/repositories/drizzle-contact.repository.js';
import { DrizzlePipelineRepository } from '../../apps/api/src/modules/crm/infrastructure/repositories/drizzle-pipeline.repository.js';
import { DrizzleDealRepository } from '../../apps/api/src/modules/crm/infrastructure/repositories/drizzle-deal.repository.js';
import { DrizzleActivityRepository } from '../../apps/api/src/modules/crm/infrastructure/repositories/drizzle-activity.repository.js';
import { DrizzleNoteRepository } from '../../apps/api/src/modules/crm/infrastructure/repositories/drizzle-note.repository.js';
import { DrizzleAttachmentRepository } from '../../apps/api/src/modules/crm/infrastructure/repositories/drizzle-attachment.repository.js';
import { CreateContactUseCase } from '../../apps/api/src/modules/crm/application/create-contact.use-case.js';
import { UpdateContactUseCase } from '../../apps/api/src/modules/crm/application/update-contact.use-case.js';
import {
  CreateCompanyUseCase,
  GetActivityUseCase,
  GetCompanyUseCase,
  GetContactUseCase,
  GetDealUseCase,
  ListActivitiesUseCase,
  ListCompaniesUseCase,
  ListContactsUseCase,
  ListDealsUseCase,
  UpdateCompanyUseCase,
} from '../../apps/api/src/modules/crm/application/crm-queries.use-cases.js';
import { DrizzleCrmReadRepository } from '../../apps/api/src/modules/crm/infrastructure/repositories/drizzle-crm-read.repository.js';
import { CreateDealUseCase } from '../../apps/api/src/modules/crm/application/create-deal.use-case.js';
import { EnsureDefaultPipelineUseCase } from '../../apps/api/src/modules/crm/application/ensure-default-pipeline.use-case.js';
import { MoveDealStageUseCase } from '../../apps/api/src/modules/crm/application/move-deal-stage.use-case.js';
import { MergeContactsUseCase } from '../../apps/api/src/modules/crm/application/merge-contacts.use-case.js';
import { CreateActivityUseCase } from '../../apps/api/src/modules/crm/application/create-activity.use-case.js';
import { UpdateActivityUseCase } from '../../apps/api/src/modules/crm/application/update-activity.use-case.js';
import { CompleteActivityUseCase } from '../../apps/api/src/modules/crm/application/complete-activity.use-case.js';
import type { AttachmentData, NoteData } from '../../apps/api/src/modules/crm/application/ports/index.js';
import {
  crmContactCreatedV1Schema,
  crmContactUpdatedV1Schema,
  crmDealLostV1Schema,
  crmDealStageChangedV1Schema,
  crmDealWonV1Schema,
} from '../../packages/contracts/src/events/index.js';

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

let container: StartedTestContainer;
let db: PostgresJsDatabase;
let ownerSql: postgres.Sql;
let ownerUserId: string;

const ownerContext: TenantContextData = {
  userId: '',
  organizationId: undefined,
  roles: [],
  permissions: [],
  locale: 'en',
};

// Recording EventBus — mirrors the events integration suite.
const observedEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
const recordingEventBus = {
  publish: async (e: { name: string; payload: Record<string, unknown> }) => {
    observedEvents.push({ name: e.name, payload: e.payload });
  },
  publishAll: async (events: Array<{ name: string; payload: Record<string, unknown> }>) => {
    for (const e of events) observedEvents.push({ name: e.name, payload: e.payload });
  },
  on: () => {},
  off: () => {},
};

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'modubiz_owner',
      POSTGRES_PASSWORD: 'modubiz_owner_password',
      POSTGRES_DB: 'modubiz_test',
    })
    .withExposedPorts(5432)
    .withStartupTimeout(180_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerConnString = `postgres://modubiz_owner:modubiz_owner_password@${host}:${port}/modubiz_test`;
  const appConnString = `postgres://${APP_ROLE}:${APP_PASSWORD}@${host}:${port}/modubiz_test`;

  ownerSql = postgres(ownerConnString, { max: 1 });

  // Create the non-owner app role that RLS applies to (mirrors docker init.sql).
  await ownerSql.unsafe(`
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
  `);

  // Apply the real core + module migrations as the owner role.
  await applyAllMigrations(ownerConnString);

  // Tables already exist, so explicit grants are needed (default privileges
  // only cover future tables).
  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  // A real user row is required (core_organizations.created_by FK).
  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'crm-owner@example.com'}, ${'hash'}, ${'Crm Owner'})
  `;

  db = drizzle(postgres(appConnString), { logger: false });
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Create an org as the owner (mirrors memberships suite seeding). */
async function createOrgForOwner(): Promise<{ orgId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `crm-${randomUUID().slice(0, 8)}`;

  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Crm Org ${slug}`,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );

  return { orgId: result.organization.id };
}

function buildCrmRepos() {
  const contactRepo = new DrizzleContactRepository(db);
  const pipelineRepo = new DrizzlePipelineRepository(db);
  const dealRepo = new DrizzleDealRepository(db);
  const activityRepo = new DrizzleActivityRepository(db);
  const noteRepo = new DrizzleNoteRepository(db);
  const attachmentRepo = new DrizzleAttachmentRepository(db);
  const txManager = new TransactionManager(db);
  const unitOfWork = new UnitOfWork(recordingEventBus as never);
  return { contactRepo, pipelineRepo, dealRepo, activityRepo, noteRepo, attachmentRepo, txManager, unitOfWork };
}

/** Create a contact with email + phone (CRM-1 satisfied). */
async function createContact(orgId: string, email: string): Promise<{ contactId: string }> {
  const { contactRepo, txManager, unitOfWork } = buildCrmRepos();
  const createContact = new CreateContactUseCase(contactRepo, txManager, unitOfWork);
  const { contact } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    createContact.execute({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email,
      phone: '+1-555-0100',
    }),
  );
  return { contactId: contact.id };
}

/** Create a deal (no pipeline → CRM-3 lazy ensure kicks in). */
async function createDeal(
  orgId: string,
  opts: { title: string; contactId: string; value: Money; baseCurrency: string; fxRate?: FxRate | null },
): Promise<{ dealId: string }> {
  const { dealRepo, pipelineRepo, txManager } = buildCrmRepos();
  const ensurePipeline = new EnsureDefaultPipelineUseCase(pipelineRepo, txManager);
  const createDeal = new CreateDealUseCase(dealRepo, pipelineRepo, ensurePipeline, txManager);
  const { deal } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    createDeal.execute({
      title: opts.title,
      contactId: opts.contactId,
      value: opts.value,
      baseCurrency: opts.baseCurrency,
      ...(opts.fxRate !== undefined ? { fxRate: opts.fxRate } : {}),
    }),
  );
  return { dealId: deal.id };
}

describe('CRM application layer (integration)', () => {
  it('CRM-3: first deal write ensures exactly one default pipeline; a second call is a no-op', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId } = await createContact(orgId, 'crm3@example.com');

    await createDeal(orgId, {
      title: 'CRM-3 deal',
      contactId,
      value: Money.of(100_000n, 'USD'),
      baseCurrency: 'USD',
    });

    // The lazy ensure created exactly one default pipeline.
    const pipelines = await ownerSql`
      SELECT id, is_default FROM crm_pipelines WHERE organization_id = ${orgId}
    `;
    const defaults = pipelines.filter((p) => p.is_default === true);
    expect(defaults).toHaveLength(1);

    // A second deal write calls ensure() again → no-op, still one default.
    await createDeal(orgId, {
      title: 'CRM-3 deal 2',
      contactId,
      value: Money.of(50_000n, 'USD'),
      baseCurrency: 'USD',
    });
    const after = await ownerSql`
      SELECT id FROM crm_pipelines WHERE organization_id = ${orgId} AND is_default = true
    `;
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(defaults[0]?.id);
  });

  it('CRM-6: appends a row to crm_deal_stage_history on every stage change', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId } = await createContact(orgId, 'crm6@example.com');
    const { dealId } = await createDeal(orgId, {
      title: 'CRM-6 deal',
      contactId,
      value: Money.of(75_000n, 'USD'),
      baseCurrency: 'USD',
    });

    const [pipelineRow] = await ownerSql`
      SELECT id FROM crm_pipelines WHERE organization_id = ${orgId} AND is_default = true
    `;
    const stages = await ownerSql`
      SELECT id, position, is_won, is_lost FROM crm_pipeline_stages
      WHERE pipeline_id = ${pipelineRow?.id} ORDER BY position
    `;

    const { dealRepo, pipelineRepo, txManager, unitOfWork } = buildCrmRepos();
    const moveStage = new MoveDealStageUseCase(dealRepo, pipelineRepo, txManager, unitOfWork);

    // Move: stage 0 → stage 1.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      moveStage.execute({ dealId, toStageId: stages[1]?.id as string }),
    );
    let history = await ownerSql`
      SELECT from_stage_id, to_stage_id FROM crm_deal_stage_history WHERE deal_id = ${dealId}
    `;
    expect(history).toHaveLength(1);
    expect(history[0]?.from_stage_id).toBe(stages[0]?.id);
    expect(history[0]?.to_stage_id).toBe(stages[1]?.id);

    // Move: stage 1 → stage 2 (won). Second history row appended.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      moveStage.execute({ dealId, toStageId: stages[2]?.id as string }),
    );
    history = await ownerSql`
      SELECT from_stage_id, to_stage_id, duration_seconds FROM crm_deal_stage_history WHERE deal_id = ${dealId}
      ORDER BY moved_at
    `;
    expect(history).toHaveLength(2);
    expect(history[1]?.from_stage_id).toBe(stages[1]?.id);
    expect(history[1]?.to_stage_id).toBe(stages[2]?.id);
    expect(Number(history[1]?.duration_seconds)).toBeGreaterThanOrEqual(0);

    // The deal is now closed (won) and cannot move directly (CRM-9).
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        moveStage.execute({ dealId, toStageId: stages[0]?.id as string }),
      ),
    ).rejects.toMatchObject({ code: 'CRM_DEAL_CLOSED_CANNOT_MOVE' });
  });

  it('CRM-8: deal value in non-base currency stores FX rate snapshot', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId } = await createContact(orgId, 'crm8@example.com');

    // Deal valued in EUR; org base currency is USD. A manual FX rate is
    // required and must be snapshotted on the deal row (CUR-5).
    const fxRate: FxRate = { rate: 1.1, source: 'test', validOn: new Date() };
    const { dealId } = await createDeal(orgId, {
      title: 'CRM-8 deal',
      contactId,
      value: Money.of(10_000n, 'EUR'), // €100.00
      baseCurrency: 'USD',
      fxRate,
    });

    const [dealRow] = await ownerSql`
      SELECT value_amount_minor, value_currency, exchange_rate, base_amount_minor
      FROM crm_deals WHERE id = ${dealId}
    `;
    expect(dealRow?.value_currency).toBe('EUR');
    expect(Number(dealRow?.value_amount_minor)).toBe(10_000);
    // 100.00 EUR × 1.1 = 110.00 USD = 11000 minor units.
    expect(Number(dealRow?.exchange_rate)).toBeCloseTo(1.1, 5);
    expect(Number(dealRow?.base_amount_minor)).toBe(11_000);
  });

  it('CRM-12: merge moves activities, notes, deals, attachments to the surviving contact', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId: sourceId } = await createContact(orgId, 'crm12-source@example.com');
    const { contactId: targetId } = await createContact(orgId, 'crm12-target@example.com');

    const { contactRepo, pipelineRepo, dealRepo, activityRepo, noteRepo, attachmentRepo, txManager, unitOfWork } =
      buildCrmRepos();

    // Attach records to the SOURCE contact: an activity, a note, an
    // attachment, and a deal.
    const createActivity = new CreateActivityUseCase(activityRepo, txManager, unitOfWork);
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({
        type: 'task',
        subject: 'Follow up with source',
        relatedType: 'contact',
        relatedId: sourceId,
      }),
    );

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      txManager.run(async (tx) => {
        const note: NoteData = {
          id: randomUUID(),
          organizationId: orgId,
          body: 'Source note',
          relatedType: 'contact',
          relatedId: sourceId,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: ownerUserId,
          updatedBy: ownerUserId,
          deletedAt: null,
        };
        await noteRepo.insert(note, tx);
        const attachment: AttachmentData = {
          id: randomUUID(),
          organizationId: orgId,
          storageKey: `crm/${sourceId}/doc.pdf`,
          filename: 'doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1234n,
          relatedType: 'contact',
          relatedId: sourceId,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: ownerUserId,
          updatedBy: ownerUserId,
          deletedAt: null,
        };
        await attachmentRepo.insert(attachment, tx);
      }),
    );

    const ensurePipeline = new EnsureDefaultPipelineUseCase(pipelineRepo, txManager);
    const createDeal = new CreateDealUseCase(dealRepo, pipelineRepo, ensurePipeline, txManager, unitOfWork);
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createDeal.execute({
        title: 'CRM-12 deal on source',
        contactId: sourceId,
        value: Money.of(30_000n, 'USD'),
        baseCurrency: 'USD',
      }),
    );

    // Merge source → target.
    const merge = new MergeContactsUseCase(
      contactRepo,
      activityRepo,
      noteRepo,
      dealRepo,
      attachmentRepo,
      txManager,
      unitOfWork,
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      merge.execute({ sourceContactId: sourceId, targetContactId: targetId }),
    );

    // Everything moved to the target; source soft-deleted.
    const [sourceRow] = await ownerSql`
      SELECT deleted_at FROM crm_contacts WHERE id = ${sourceId}
    `;
    expect(sourceRow?.deleted_at).not.toBeNull();

    const [activityRow] = await ownerSql`
      SELECT related_id FROM crm_activities WHERE subject = 'Follow up with source'
    `;
    expect(activityRow?.related_id).toBe(targetId);

    const [noteRow] = await ownerSql`
      SELECT related_id FROM crm_notes WHERE body = 'Source note'
    `;
    expect(noteRow?.related_id).toBe(targetId);

    const [attachmentRow] = await ownerSql`
      SELECT related_id FROM crm_attachments WHERE filename = 'doc.pdf'
    `;
    expect(attachmentRow?.related_id).toBe(targetId);

    const [dealRow] = await ownerSql`
      SELECT contact_id FROM crm_deals WHERE title = 'CRM-12 deal on source'
    `;
    expect(dealRow?.contact_id).toBe(targetId);
  });

  it('publishes crm.deal.won.v1 only after commit', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId } = await createContact(orgId, 'crm-evt@example.com');
    const { dealId } = await createDeal(orgId, {
      title: 'Event deal',
      contactId,
      value: Money.of(20_000n, 'USD'),
      baseCurrency: 'USD',
    });

    const [pipelineRow] = await ownerSql`
      SELECT id FROM crm_pipelines WHERE organization_id = ${orgId} AND is_default = true
    `;
    const stages = await ownerSql`
      SELECT id, position, is_won, is_lost FROM crm_pipeline_stages
      WHERE pipeline_id = ${pipelineRow?.id} ORDER BY position
    `;

    const { dealRepo, pipelineRepo, txManager, unitOfWork } = buildCrmRepos();
    const moveStage = new MoveDealStageUseCase(dealRepo, pipelineRepo, txManager, unitOfWork);

    observedEvents.length = 0;

    // A move that FAILS mid-transaction publishes nothing (OPS-3): moving to
    // the lost stage without a lost_reason_code violates CRM-7, so the
    // transaction rolls back and no events fire.
    const lostStage = stages.find((s) => s.is_lost === true);
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        moveStage.execute({ dealId, toStageId: lostStage?.id as string }),
      ),
    ).rejects.toMatchObject({ code: 'CRM_LOST_REASON_REQUIRED' });
    expect(observedEvents).toHaveLength(0);

    // The successful move to the won stage publishes stage_changed + won
    // only AFTER the transaction commits.
    const fresh = buildCrmRepos();
    const freshMove = new MoveDealStageUseCase(fresh.dealRepo, fresh.pipelineRepo, fresh.txManager, fresh.unitOfWork);
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      freshMove.execute({ dealId, toStageId: stages[2]?.id as string }),
    );
    expect(observedEvents.map((e) => e.name)).toEqual(['crm.deal.stage_changed.v1', 'crm.deal.won.v1']);

    // The won event carries the deal value + FX snapshot fields.
    const wonEvent = observedEvents.find((e) => e.name === 'crm.deal.won.v1');
    expect(wonEvent).toBeDefined();
    expect(crmDealStageChangedV1Schema.parse(observedEvents[0]?.payload).dealId).toBe(dealId);
    expect(crmDealWonV1Schema.parse(wonEvent?.payload)).toMatchObject({ dealId, ownerUserId: null });
  });

  it('publishes a schema-valid contact-created event with a nullable owner', async () => {
    const { orgId } = await createOrgForOwner();
    observedEvents.length = 0;
    const { contactId } = await createContact(orgId, 'crm-event-contract@example.com');
    const contactEvent = observedEvents.find((event) => event.name === 'crm.contact.created.v1');
    expect(contactEvent).toBeDefined();
    expect(crmContactCreatedV1Schema.parse(contactEvent?.payload)).toMatchObject({
      contactId,
      ownerUserId: null,
    });

    observedEvents.length = 0;
    const repos = buildCrmRepos();
    const updateContact = new UpdateContactUseCase(repos.contactRepo, repos.txManager, repos.unitOfWork);
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      updateContact.execute({ contactId, phone: '+1-555-0199' }),
    );
    const updatedEvent = observedEvents.find((event) => event.name === 'crm.contact.updated.v1');
    expect(crmContactUpdatedV1Schema.parse(updatedEvent?.payload)).toMatchObject({
      contactId,
      phone: '+1-555-0199',
      ownerUserId: null,
    });
  });

  it('CRM-7: publishes a schema-valid lost event and rejects blank reasons', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId } = await createContact(orgId, 'crm-lost-event@example.com');
    const { dealId } = await createDeal(orgId, {
      title: 'Lost event deal',
      contactId,
      value: Money.of(20_000n, 'USD'),
      baseCurrency: 'USD',
    });
    const [pipelineRow] = await ownerSql`
      SELECT id FROM crm_pipelines WHERE organization_id = ${orgId} AND is_default = true
    `;
    const [lostStage] = await ownerSql`
      SELECT id FROM crm_pipeline_stages WHERE pipeline_id = ${pipelineRow?.id} AND is_lost = true
    `;
    const moveRepos = buildCrmRepos();
    const moveStage = new MoveDealStageUseCase(
      moveRepos.dealRepo,
      moveRepos.pipelineRepo,
      moveRepos.txManager,
      moveRepos.unitOfWork,
    );

    observedEvents.length = 0;
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        moveStage.execute({ dealId, toStageId: lostStage?.id as string, lostReasonCode: '   ' }),
      ),
    ).rejects.toMatchObject({ code: 'CRM_LOST_REASON_REQUIRED' });
    expect(observedEvents).toHaveLength(0);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      moveStage.execute({ dealId, toStageId: lostStage?.id as string, lostReasonCode: 'price' }),
    );
    expect(observedEvents.map((event) => event.name)).toEqual(['crm.deal.stage_changed.v1', 'crm.deal.lost.v1']);
    const lostEvent = observedEvents.find((event) => event.name === 'crm.deal.lost.v1');
    expect(crmDealLostV1Schema.parse(lostEvent?.payload)).toMatchObject({
      dealId,
      lostReasonCode: 'price',
      ownerUserId: null,
    });
  });

  it('creates and updates a company, persisting address as jsonb (object-binding regression)', async () => {
    // Regression: `address` is a jsonb column, but drizzle's postgres-js
    // driver does NOT JSON-stringify plain objects (identity serializer, see
    // db-date.ts) — binding the DTO's `{}` default crashed with
    // ERR_INVALID_ARG_TYPE and produced a 500 INTERNAL_ERROR. The repositories
    // must serialize the object explicitly, mirroring the pipeline repo's
    // `${JSON.stringify(nameI18n)}::jsonb` pattern.
    const { orgId } = await createOrgForOwner();
    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const createCompany = new CreateCompanyUseCase(readRepo, txManager);

    const company = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createCompany.execute({
        name: 'Acme Corp',
        domain: 'acme.example.com',
        industry: 'Manufacturing',
        address: { city: 'Springfield' },
      }),
    );
    expect(company.address).toEqual({ city: 'Springfield' });

    const updated = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      new UpdateCompanyUseCase(readRepo, txManager).execute(company.id, {
        address: { city: 'Shelbyville', zip: '12345' },
      }),
    );
    expect(updated?.address).toEqual({ city: 'Shelbyville', zip: '12345' });
    const listed = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      new ListCompaniesUseCase(readRepo, txManager).execute(),
    );
    expect(listed.items.some((item) => item.id === company.id)).toBe(true);
  });

  it('getById: contact/company detail round-trips and deal detail includes stage history', async () => {
    const { orgId } = await createOrgForOwner();
    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const getContact = new GetContactUseCase(readRepo, txManager);
    const getCompany = new GetCompanyUseCase(readRepo, txManager);
    const getDeal = new GetDealUseCase(readRepo, txManager);

    // Contact detail round-trip + fail-closed NOT_FOUND for another org's id.
    const { contactId } = await createContact(orgId, 'detail-contact@example.com');
    const contactDetail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getContact.execute(contactId),
    );
    expect(contactDetail).toMatchObject({ id: contactId, firstName: 'Ada', lastName: 'Lovelace' });
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        getContact.execute(randomUUID()),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Company detail round-trip preserves the jsonb address.
    const company = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      new CreateCompanyUseCase(readRepo, txManager).execute({
        name: 'Detail Co',
        domain: 'detail.example.com',
        industry: 'Tech',
        address: { city: 'Springfield' },
      }),
    );
    const companyDetail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getCompany.execute(company.id),
    );
    expect(companyDetail.address).toEqual({ city: 'Springfield' });

    // Deal detail includes the append-only stage history (CRM-6).
    const { dealId } = await createDeal(orgId, {
      title: 'Detail deal',
      contactId,
      value: Money.of(10_000n, 'USD'),
      baseCurrency: 'USD',
    });
    const [pipelineRow] = await ownerSql`
      SELECT id FROM crm_pipelines WHERE organization_id = ${orgId} AND is_default = true
    `;
    const [lostStage] = await ownerSql`
      SELECT id FROM crm_pipeline_stages WHERE pipeline_id = ${pipelineRow?.id} AND is_lost = true
    `;
    const moveRepos = buildCrmRepos();
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      new MoveDealStageUseCase(
        moveRepos.dealRepo,
        moveRepos.pipelineRepo,
        moveRepos.txManager,
        moveRepos.unitOfWork,
      ).execute({ dealId, toStageId: lostStage?.id as string, lostReasonCode: 'price' }),
    );
    const dealDetail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getDeal.execute(dealId),
    );
    expect(dealDetail).toMatchObject({ id: dealId, status: 'lost', lostReasonCode: 'price' });
    const history = dealDetail?.stageHistory as Array<{ toStageId: string }>;
    expect(history).toHaveLength(1);
    expect(history[0]?.toStageId).toBe(lostStage?.id);
  });

  it('paginates the contacts list with total and stable updated_at DESC order', async () => {
    const { orgId } = await createOrgForOwner();
    for (let i = 0; i < 15; i++) {
      await createContact(orgId, `pager-${i}@example.com`);
    }
    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const listContacts = new ListContactsUseCase(readRepo, txManager);

    const page1 = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listContacts.execute({ page: 1, pageSize: 10 }),
    );
    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBe(15);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(10);

    const page2 = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listContacts.execute({ page: 2, pageSize: 10 }),
    );
    expect(page2.items).toHaveLength(5);
    // No overlap between pages.
    const page1Ids = new Set(page1.items.map((item) => item.id as string));
    expect(page2.items.every((item) => !page1Ids.has(item.id as string))).toBe(true);
  });

  it('lists most recently edited contacts first and filters by company', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactRepo, txManager, unitOfWork } = buildCrmRepos();
    const create = new CreateContactUseCase(contactRepo, txManager, unitOfWork);
    const update = new UpdateContactUseCase(contactRepo, txManager, unitOfWork);
    const readRepo = new DrizzleCrmReadRepository(db);
    const listContacts = new ListContactsUseCase(readRepo, txManager);
    const listCompanies = new ListCompaniesUseCase(readRepo, txManager);
    const createCompany = new CreateCompanyUseCase(readRepo, txManager);

    const company = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createCompany.execute({ name: 'Filter Co', domain: 'filter.example.com', industry: 'Tech', address: {} }),
    );
    const first = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      create.execute({
        firstName: 'First',
        lastName: 'C',
        email: 'first@example.com',
        phone: null,
        companyId: company.id,
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      create.execute({ firstName: 'Second', lastName: 'C', email: 'second@example.com', phone: null }),
    );

    // Company filter narrows to that company's contacts only.
    const filtered = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listContacts.execute({ companyId: company.id }),
    );
    expect(filtered.items.map((item) => item.firstName)).toEqual(['First']);
    expect(filtered.total).toBe(1);

    // Editing a contact bumps updated_at → it surfaces first (recently edited).
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      update.execute({ contactId: first.contact.id, phone: '+1-555-0999' }),
    );
    const reordered = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listContacts.execute(),
    );
    expect(reordered.items[0]?.firstName).toBe('First');

    // Companies paginate + search too.
    const companies = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listCompanies.execute({ search: 'Filter' }),
    );
    expect(companies.total).toBeGreaterThanOrEqual(1);
    expect(companies.items[0]).toMatchObject({ name: 'Filter Co' });
  });

  it('persists and emits secondaryPhone on create and update', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactRepo, txManager, unitOfWork } = buildCrmRepos();
    const create = new CreateContactUseCase(contactRepo, txManager, unitOfWork);
    const update = new UpdateContactUseCase(contactRepo, txManager, unitOfWork);
    const readRepo = new DrizzleCrmReadRepository(db);
    const getContact = new GetContactUseCase(readRepo, txManager);

    observedEvents.length = 0;
    const { contact } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      create.execute({
        firstName: 'Dual',
        lastName: 'Phone',
        email: 'dual-phone@example.com',
        phone: '+1-555-0101',
        secondaryPhone: '+1-555-0102',
        preferredLocale: 'ar',
        preferredCurrency: 'USD',
      }),
    );
    expect(contact.secondaryPhone).toBe('+1-555-0102');
    const createdEvent = observedEvents.find((event) => event.name === 'crm.contact.created.v1');
    expect(crmContactCreatedV1Schema.parse(createdEvent?.payload)).toMatchObject({
      contactId: contact.id,
      secondaryPhone: '+1-555-0102',
    });

    observedEvents.length = 0;
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      update.execute({ contactId: contact.id, secondaryPhone: null }),
    );
    const detail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getContact.execute(contact.id),
    );
    expect(detail?.secondaryPhone).toBeNull();
    const updatedEvent = observedEvents.find((event) => event.name === 'crm.contact.updated.v1');
    expect(crmContactUpdatedV1Schema.parse(updatedEvent?.payload)).toMatchObject({
      contactId: contact.id,
      secondaryPhone: null,
    });
  });

  it('paginates deals and filters by title', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId } = await createContact(orgId, 'deal-page@example.com');
    await createDeal(orgId, { title: 'Alpha deal', contactId, value: Money.of(100_000n, 'USD'), baseCurrency: 'USD' });
    await createDeal(orgId, { title: 'Beta deal', contactId, value: Money.of(200_000n, 'USD'), baseCurrency: 'USD' });
    await createDeal(orgId, { title: 'Gamma deal', contactId, value: Money.of(300_000n, 'USD'), baseCurrency: 'USD' });

    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const listDeals = new ListDealsUseCase(readRepo, txManager);

    const page = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ page: 2, pageSize: 2 }),
    );
    expect(page.total).toBe(3);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(2);
    expect(page.items).toHaveLength(1);

    const filtered = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ search: 'beta' }),
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({ title: 'Beta deal' });
  });

  it('lists deals with joined contact/company names and filters by updated date range', async () => {
    const { orgId } = await createOrgForOwner();
    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const createCompany = new CreateCompanyUseCase(readRepo, txManager);

    // A deal referencing both a contact and a company, plus one with only a
    // company — the list query must resolve display names via LEFT JOINs.
    const company = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createCompany.execute({ name: 'Deal Names Co', domain: 'names.example.com', industry: 'Tech', address: {} }),
    );
    const { contactId } = await createContact(orgId, 'deal-names@example.com');
    const { dealId: bothDealId } = await createDeal(orgId, {
      title: 'Both deal',
      contactId,
      value: Money.of(100_000n, 'USD'),
      baseCurrency: 'USD',
    });
    // Create a company-only deal through the domain so the LEFT JOIN covers it.
    const { dealRepo, pipelineRepo, txManager: tx2, unitOfWork } = buildCrmRepos();
    const ensurePipeline = new EnsureDefaultPipelineUseCase(pipelineRepo, tx2);
    const createDealUC = new CreateDealUseCase(dealRepo, pipelineRepo, ensurePipeline, tx2, unitOfWork);
    const { deal: companyDeal } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        createDealUC.execute({
          title: 'Company-only deal',
          companyId: company.id,
          value: Money.of(50_000n, 'USD'),
          baseCurrency: 'USD',
        }),
    );

    const listDeals = new ListDealsUseCase(readRepo, txManager);
    const listed = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ pageSize: 100 }),
    );
    const bothDeal = listed.items.find((item) => item.id === bothDealId);
    const companyOnlyDeal = listed.items.find((item) => item.id === companyDeal.id);
    expect(bothDeal).toMatchObject({ contactName: 'Ada Lovelace', companyName: null });
    expect(companyOnlyDeal).toMatchObject({ contactName: null, companyName: 'Deal Names Co' });

    // The updated-day filter matches deals touched today (all just created).
    const today = new Date().toISOString().slice(0, 10);
    const todaysDeals = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ fromDate: today, toDate: today }),
    );
    expect(todaysDeals.total).toBe(2);
    // A past range matches nothing.
    const oldDeals = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ fromDate: '2000-01-01', toDate: '2000-01-02' }),
    );
    expect(oldDeals.total).toBe(0);
  });

  it('filters deals by stage and returns the exact org-base value total per filter', async () => {
    const { orgId } = await createOrgForOwner();
    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const listDeals = new ListDealsUseCase(readRepo, txManager);
    const { contactId } = await createContact(orgId, 'deal-stage-total@example.com');

    // Two deals land in stage 0 — one in the org base currency (USD), one in
    // EUR converted to base at write time (CRM-8 FX snapshot).
    const { dealId: usdDealId } = await createDeal(orgId, {
      title: 'Stage total USD',
      contactId,
      value: Money.of(10_000n, 'USD'),
      baseCurrency: 'USD',
    });
    const { dealId: eurDealId } = await createDeal(orgId, {
      title: 'Stage total EUR',
      contactId,
      value: Money.of(10_000n, 'EUR'),
      baseCurrency: 'USD',
      fxRate: { rate: 1.1, source: 'test', validOn: new Date() },
    });

    const [pipelineRow] = await ownerSql`
      SELECT id FROM crm_pipelines WHERE organization_id = ${orgId} AND is_default = true
    `;
    const stages = await ownerSql`
      SELECT id, position FROM crm_pipeline_stages WHERE pipeline_id = ${pipelineRow?.id} ORDER BY position
    `;

    // Move the EUR deal to stage 1 so both stages are populated.
    const moveRepos = buildCrmRepos();
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      new MoveDealStageUseCase(
        moveRepos.dealRepo,
        moveRepos.pipelineRepo,
        moveRepos.txManager,
        moveRepos.unitOfWork,
      ).execute({ dealId: eurDealId, toStageId: stages[1]?.id as string }),
    );

    // Per-column (stage) filter narrows the page and sums in org-base units.
    const stage0 = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ stageId: stages[0]?.id as string }),
    );
    expect(stage0.total).toBe(1);
    expect(stage0.items[0]?.id).toBe(usdDealId);
    expect(stage0.totalValueBaseMinor).toBe('10000');

    // The FX snapshot (11000 minor) is what the column total sums — not the
    // raw €100.00.
    const stage1 = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ stageId: stages[1]?.id as string }),
    );
    expect(stage1.total).toBe(1);
    expect(stage1.items[0]?.id).toBe(eurDealId);
    expect(stage1.totalValueBaseMinor).toBe('11000');

    // No stage filter: both rows, and the total covers both stages.
    const all = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute(),
    );
    expect(all.total).toBe(2);
    expect(all.totalValueBaseMinor).toBe('21000');

    // List rows carry the timestamps + base amount the table view needs. A
    // base-currency deal stores base_amount_minor = NULL (fallback to its own
    // minor units when summing).
    expect(stage0.items[0]).toMatchObject({
      baseAmountMinor: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('sorts deals by title and by org-base value', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId } = await createContact(orgId, 'deal-sort@example.com');
    await createDeal(orgId, { title: 'Alpha', contactId, value: Money.of(100_000n, 'USD'), baseCurrency: 'USD' });
    await createDeal(orgId, { title: 'Beta', contactId, value: Money.of(300_000n, 'USD'), baseCurrency: 'USD' });
    await createDeal(orgId, { title: 'Gamma', contactId, value: Money.of(200_000n, 'USD'), baseCurrency: 'USD' });

    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const listDeals = new ListDealsUseCase(readRepo, txManager);

    const byTitle = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ sortBy: 'title', sortDir: 'asc' }),
    );
    expect(byTitle.items.map((item) => item.title)).toEqual(['Alpha', 'Beta', 'Gamma']);

    // Value sorts by the org-base amount (all deals comparable regardless of
    // their own currency) — here simply the USD minor units, descending.
    const byValue = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listDeals.execute({ sortBy: 'value', sortDir: 'desc' }),
    );
    expect(byValue.items.map((item) => item.title)).toEqual(['Beta', 'Gamma', 'Alpha']);
  });

  it('filters activities by due-date range', async () => {
    const { orgId } = await createOrgForOwner();
    const { activityRepo, txManager, unitOfWork } = buildCrmRepos();
    const createActivity = new CreateActivityUseCase(activityRepo, txManager, unitOfWork);
    // Due yesterday (past), today, and in the future — the range is inclusive.
    const now = new Date();
    const isoDay = (offset: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
      return d.toISOString().slice(0, 10);
    };
    for (const [subject, offset] of [
      ['Yesterday task', -1],
      ['Today task', 0],
      ['Tomorrow task', 1],
    ] as const) {
      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        createActivity.execute({ type: 'task', subject, dueAt: new Date(isoDay(offset)) }),
      );
    }

    const readRepo = new DrizzleCrmReadRepository(db);
    const listActivities = new ListActivitiesUseCase(readRepo, txManager);

    // An undated activity must stay visible in any date-filtered view — a
    // task with no due date shouldn't vanish just because the page defaults
    // to today's range.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Undated task' }),
    );

    // Today's range matches the activity due today plus the undated one.
    const today = isoDay(0);
    const todays = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ fromDate: today, toDate: today }),
    );
    expect(todays.total).toBe(2);
    expect(todays.items.some((item) => item.subject === 'Today task')).toBe(true);
    expect(todays.items.some((item) => item.subject === 'Undated task')).toBe(true);

    // A two-day window (yesterday..today) matches the past + today rows + the
    // undated one.
    const window = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ fromDate: isoDay(-1), toDate: today }),
    );
    expect(window.total).toBe(3);

    // A past range matches no dated activities — only the undated one stays
    // visible (undated tasks are never hidden by a due-date filter).
    const old = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ fromDate: '2000-01-01', toDate: '2000-01-02' }),
    );
    expect(old.total).toBe(1);
    expect(old.items[0]).toMatchObject({ subject: 'Undated task' });
  });

  it('paginates activities and filters by subject', async () => {
    const { orgId } = await createOrgForOwner();
    const { activityRepo, txManager, unitOfWork } = buildCrmRepos();
    const createActivity = new CreateActivityUseCase(activityRepo, txManager, unitOfWork);
    for (const subject of ['Call Alice', 'Email Bob', 'Meeting Carol']) {
      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        createActivity.execute({ type: 'task', subject }),
      );
    }

    const readRepo = new DrizzleCrmReadRepository(db);
    const listActivities = new ListActivitiesUseCase(readRepo, txManager);

    const page = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ page: 1, pageSize: 2 }),
    );
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);

    const filtered = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ search: 'email' }),
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({ subject: 'Email Bob' });
  });

  it('filters activities by assignee (CRM-14)', async () => {
    const { orgId } = await createOrgForOwner();
    const { activityRepo, txManager, unitOfWork } = buildCrmRepos();
    const createActivity = new CreateActivityUseCase(activityRepo, txManager, unitOfWork);

    // A second active member to assign to.
    const assignee = randomUUID();
    await ownerSql`
      INSERT INTO core_users (id, email, password_hash, name)
      VALUES (${assignee}, ${`assignee-filter-${orgId}@example.com`}, ${'hash'}, ${'Filter Assignee'})
    `;
    await ownerSql`
      INSERT INTO core_memberships (id, organization_id, user_id, role_id, status)
      VALUES (${randomUUID()}, ${orgId}, ${assignee}, (SELECT id FROM core_roles WHERE organization_id = ${orgId} AND key = 'member'), 'active')
    `;
    const activeMemberIds = new Set([assignee]);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Mine', assignedToUserId: assignee, activeMemberIds }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Unassigned' }),
    );

    const readRepo = new DrizzleCrmReadRepository(db);
    const listActivities = new ListActivitiesUseCase(readRepo, txManager);

    // Narrowing to the assignee returns only their activities.
    const mine = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ assigneeUserId: assignee }),
    );
    expect(mine.total).toBe(1);
    expect(mine.items[0]).toMatchObject({ subject: 'Mine', assignedToUserId: assignee });

    // Without the filter both are visible.
    const all = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute(),
    );
    expect(all.total).toBe(2);

    // An assignee with no activities returns an empty page (not an error).
    const none = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ assigneeUserId: randomUUID() }),
    );
    expect(none.total).toBe(0);
  });

  it('filters activities by unassigned and by completion status', async () => {
    const { orgId } = await createOrgForOwner();
    const { activityRepo, txManager, unitOfWork } = buildCrmRepos();
    const createActivity = new CreateActivityUseCase(activityRepo, txManager, unitOfWork);
    const completeActivity = new CompleteActivityUseCase(activityRepo, txManager);
    const readRepo = new DrizzleCrmReadRepository(db);
    const listActivities = new ListActivitiesUseCase(readRepo, txManager);

    // One unassigned task (later completed), one unassigned open task, and
    // one assigned task (left open).
    const assignee = randomUUID();
    await ownerSql`
      INSERT INTO core_users (id, email, password_hash, name)
      VALUES (${assignee}, ${`status-filter-${orgId}@example.com`}, ${'hash'}, ${'Status Assignee'})
    `;
    await ownerSql`
      INSERT INTO core_memberships (id, organization_id, user_id, role_id, status)
      VALUES (${randomUUID()}, ${orgId}, ${assignee}, (SELECT id FROM core_roles WHERE organization_id = ${orgId} AND key = 'member'), 'active')
    `;
    const activeMemberIds = new Set([assignee]);

    const completedUnassigned = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => createActivity.execute({ type: 'task', subject: 'Done unassigned' }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Open unassigned' }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Open assigned', assignedToUserId: assignee, activeMemberIds }),
    );

    // Unassigned-only narrows to the two tasks with no assignee.
    const unassigned = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ unassigned: true }),
    );
    expect(unassigned.total).toBe(2);
    expect(unassigned.items.every((item) => item.assignedToUserId === null)).toBe(true);

    // Complete one of the unassigned tasks, then check the status filters.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      completeActivity.execute({ activityId: completedUnassigned.activity.id }),
    );

    const open = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ completed: false }),
    );
    expect(open.total).toBe(2);
    expect(open.items.every((item) => item.completedAt === null)).toBe(true);

    const done = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ completed: true }),
    );
    expect(done.total).toBe(1);
    expect(done.items[0]).toMatchObject({ subject: 'Done unassigned' });

    // Unassigned + open narrows further: exactly the still-open unassigned one.
    const unassignedOpen = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => listActivities.execute({ unassigned: true, completed: false }),
    );
    expect(unassignedOpen.total).toBe(1);
    expect(unassignedOpen.items[0]).toMatchObject({ subject: 'Open unassigned' });

    // No filters: all three visible.
    const all = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute(),
    );
    expect(all.total).toBe(3);
  });

  it('lists activities with resolved related-entity names and deal stage', async () => {
    const { orgId } = await createOrgForOwner();
    const { contactId } = await createContact(orgId, 'related-name@example.com');
    const { dealId } = await createDeal(orgId, {
      title: 'Stage-named deal',
      contactId,
      value: Money.of(40_000n, 'USD'),
      baseCurrency: 'USD',
    });
    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const { activityRepo, txManager: tx2, unitOfWork } = buildCrmRepos();
    const createActivity = new CreateActivityUseCase(activityRepo, tx2, unitOfWork);

    // One activity on the deal, one on the contact, one on a company, and one
    // unlinked — the list must resolve names for each related type.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Deal follow-up', relatedType: 'deal', relatedId: dealId }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({
        type: 'email',
        subject: 'Contact follow-up',
        relatedType: 'contact',
        relatedId: contactId,
      }),
    );
    const company = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      new CreateCompanyUseCase(readRepo, txManager).execute({
        name: 'Related Co',
        domain: 'related.example.com',
        industry: 'Tech',
        address: {},
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({
        type: 'meeting',
        subject: 'Company follow-up',
        relatedType: 'company',
        relatedId: company.id,
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Solo task' }),
    );

    const listActivities = new ListActivitiesUseCase(readRepo, txManager);
    const all = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listActivities.execute({ pageSize: 100 }),
    );
    const bySubject = (subject: string) => all.items.find((item) => item.subject === subject);

    // Deal-related: title + the deal's current stage name (localized map).
    const dealActivity = bySubject('Deal follow-up');
    expect(dealActivity).toMatchObject({ relatedName: 'Stage-named deal', relatedType: 'deal' });
    expect(dealActivity?.dealStageNameI18n).toBeTruthy();
    expect((dealActivity?.dealStageNameI18n as Record<string, string>).en).toBeTruthy();

    // Contact-related: full name; company-related: company name; unlinked: null.
    expect(bySubject('Contact follow-up')).toMatchObject({ relatedName: 'Ada Lovelace' });
    expect(bySubject('Company follow-up')).toMatchObject({ relatedName: 'Related Co' });
    const solo = bySubject('Solo task');
    expect(solo?.relatedName).toBeNull();
    expect(solo?.dealStageNameI18n).toBeNull();
  });

  it('deal detail returns createdBy and updatedBy, and updates stamp updatedBy on move', async () => {
    const { orgId } = await createOrgForOwner();
    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const getDeal = new GetDealUseCase(readRepo, txManager);

    const { contactId } = await createContact(orgId, 'deal-audit@example.com');
    const { dealId } = await createDeal(orgId, {
      title: 'Audited deal',
      contactId,
      value: Money.of(10_000n, 'USD'),
      baseCurrency: 'USD',
    });

    const detail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getDeal.execute(dealId),
    );
    // Both stamps are the creating session user at write time.
    expect(detail?.createdByUserId).toBe(ownerUserId);
    expect(detail?.updatedByUserId).toBe(ownerUserId);

    // A stage move by a different user stamps updated_by with the mover
    // (deal entity sets it from the session), while created_by stays put.
    const otherUser = randomUUID();
    const [pipelineRow] = await ownerSql`
      SELECT id FROM crm_pipelines WHERE organization_id = ${orgId} AND is_default = true
    `;
    const stages = await ownerSql`
      SELECT id, position FROM crm_pipeline_stages WHERE pipeline_id = ${pipelineRow?.id} ORDER BY position
    `;
    const moveRepos = buildCrmRepos();
    await TenantContext.run({ ...ownerContext, userId: otherUser, organizationId: orgId }, () =>
      new MoveDealStageUseCase(
        moveRepos.dealRepo,
        moveRepos.pipelineRepo,
        moveRepos.txManager,
        moveRepos.unitOfWork,
      ).execute({ dealId, toStageId: stages[1]?.id as string }),
    );
    const after = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getDeal.execute(dealId),
    );
    expect(after?.createdByUserId).toBe(ownerUserId);
    expect(after?.updatedByUserId).toBe(otherUser);
  });

  it('contact, company, and activity details return audit stamps (createdBy/updatedBy)', async () => {
    const { orgId } = await createOrgForOwner();
    const readRepo = new DrizzleCrmReadRepository(db);
    const txManager = new TransactionManager(db);
    const getContact = new GetContactUseCase(readRepo, txManager);
    const getCompany = new GetCompanyUseCase(readRepo, txManager);
    const getActivity = new GetActivityUseCase(readRepo, txManager);

    // Contact: created/updated stamped by the session user.
    const { contactId } = await createContact(orgId, 'audit-contact@example.com');
    const contactDetail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getContact.execute(contactId),
    );
    expect(contactDetail?.createdByUserId).toBe(ownerUserId);
    expect(contactDetail?.updatedByUserId).toBe(ownerUserId);

    // Company: created/updated stamped via the use cases.
    const createCompany = new CreateCompanyUseCase(readRepo, txManager);
    const company = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createCompany.execute({ name: 'Audit Co', domain: 'audit.example.com', industry: 'Tech', address: {} }),
    );
    expect(company.createdByUserId).toBe(ownerUserId);
    expect(company.updatedByUserId).toBe(ownerUserId);
    const companyDetail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getCompany.execute(company.id),
    );
    expect(companyDetail.createdByUserId).toBe(ownerUserId);
    expect(companyDetail.updatedByUserId).toBe(ownerUserId);

    // Activity: created/updated stamped via the domain entity.
    const { activityRepo, txManager: tx2, unitOfWork } = buildCrmRepos();
    const createActivity = new CreateActivityUseCase(activityRepo, tx2, unitOfWork);
    const { activity } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Audit activity' }),
    );
    const activityDetail = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => getActivity.execute(activity.id),
    );
    expect(activityDetail?.createdByUserId).toBe(ownerUserId);
    expect(activityDetail?.updatedByUserId).toBe(ownerUserId);
  });

  it('getActivityById returns detail with timestamps and update extends the due date (CRM-13)', async () => {
    const { orgId } = await createOrgForOwner();
    const { activityRepo, txManager, unitOfWork } = buildCrmRepos();
    const createActivity = new CreateActivityUseCase(activityRepo, txManager, unitOfWork);
    const due = new Date('2030-01-15T09:00:00.000Z');
    const { activity } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createActivity.execute({ type: 'task', subject: 'Detail activity', dueAt: due }),
    );

    const readRepo = new DrizzleCrmReadRepository(db);
    const getActivity = new GetActivityUseCase(readRepo, txManager);

    // Detail round-trip: fields + ISO timestamps.
    const detail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getActivity.execute(activity.id),
    );
    expect(detail).toMatchObject({
      id: activity.id,
      subject: 'Detail activity',
      type: 'task',
      dueAt: due.toISOString(),
      completedAt: null,
    });
    expect(detail?.createdAt).toBeTruthy();
    expect(detail?.updatedAt).toBeTruthy();

    // Fail-closed: a random id (or another org's id) is NOT_FOUND.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        getActivity.execute(randomUUID()),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Extend the due date (CRM-13: allowed while incomplete).
    const updateActivity = new UpdateActivityUseCase(activityRepo, txManager);
    const extended = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      updateActivity.execute({ activityId: activity.id, dueAt: new Date('2030-02-20T09:00:00.000Z') }),
    );
    expect(extended.activity.dueAt?.toISOString()).toBe('2030-02-20T09:00:00.000Z');

    // Subject/type edits persist through the same PATCH flow; an untouched
    // field stays unchanged (partial update).
    const edited = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      updateActivity.execute({ activityId: activity.id, type: 'email', subject: 'Renamed activity' }),
    );
    expect(edited.activity.type).toBe('email');
    expect(edited.activity.subject).toBe('Renamed activity');
    expect(edited.activity.dueAt?.toISOString()).toBe('2030-02-20T09:00:00.000Z');

    // Reassignment (CRM-14): the org owner is an active member — assigning to
    // them succeeds; a non-member is rejected with the active-member error.
    const assignee = randomUUID();
    await ownerSql`
      INSERT INTO core_users (id, email, password_hash, name)
      VALUES (${assignee}, ${`assignee-${orgId}@example.com`}, ${'hash'}, ${'Assignee'})
    `;
    await ownerSql`
      INSERT INTO core_memberships (id, organization_id, user_id, role_id, status)
      VALUES (${randomUUID()}, ${orgId}, ${assignee}, (SELECT id FROM core_roles WHERE organization_id = ${orgId} AND key = 'member'), 'active')
    `;
    const activeMemberIds = new Set([assignee]);
    const assigned = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      updateActivity.execute({ activityId: activity.id, assignedToUserId: assignee, activeMemberIds }),
    );
    expect(assigned.activity.assignedTo).toBe(assignee);

    // CRM-14: assigning to someone outside the active-member set is rejected.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        updateActivity.execute({
          activityId: activity.id,
          assignedToUserId: randomUUID(),
          activeMemberIds,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CRM_ACTIVITY_ASSIGNEE_NOT_ACTIVE_MEMBER' });

    // Unassigning (null) is always allowed.
    const unassigned = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      updateActivity.execute({ activityId: activity.id, assignedToUserId: null }),
    );
    expect(unassigned.activity.assignedTo).toBeNull();

    // A completed activity is immutable (CRM-13): every edit — due date,
    // subject, type, or reassignment — is rejected; only notes may be appended.
    const completeActivity = new CompleteActivityUseCase(activityRepo, txManager);
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      completeActivity.execute({ activityId: activity.id }),
    );
    for (const patch of [
      { dueAt: new Date('2030-03-01T09:00:00.000Z') },
      { subject: 'Still immutable' },
      { type: 'call' },
      { assignedToUserId: assignee, activeMemberIds },
    ]) {
      await expect(
        TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
          updateActivity.execute({ activityId: activity.id, ...patch }),
        ),
      ).rejects.toMatchObject({ code: 'CRM_ACTIVITY_COMPLETED_IMMUTABLE' });
    }
  });
});
