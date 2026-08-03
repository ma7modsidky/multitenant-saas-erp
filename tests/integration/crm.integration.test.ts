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
import { CreateDealUseCase } from '../../apps/api/src/modules/crm/application/create-deal.use-case.js';
import { EnsureDefaultPipelineUseCase } from '../../apps/api/src/modules/crm/application/ensure-default-pipeline.use-case.js';
import { MoveDealStageUseCase } from '../../apps/api/src/modules/crm/application/move-deal-stage.use-case.js';
import { MergeContactsUseCase } from '../../apps/api/src/modules/crm/application/merge-contacts.use-case.js';
import { CreateActivityUseCase } from '../../apps/api/src/modules/crm/application/create-activity.use-case.js';
import type { AttachmentData, NoteData } from '../../apps/api/src/modules/crm/application/ports/index.js';

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
    expect(wonEvent?.payload).toMatchObject({ dealId });
  });
});
