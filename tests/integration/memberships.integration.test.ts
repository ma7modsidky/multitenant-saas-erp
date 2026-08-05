/**
 * Member invitation integration tests — real Postgres, RLS active.
 *
 * Covers the full browser flow that previously had no automated coverage:
 *   - AUTHZ-8: invite resolves the invitee by email and rejects existing members
 *   - AUTHZ-8: duplicate pending invitations are rejected
 *   - AUTH-3/AUTH-9: a freshly signed-up user (token WITHOUT an org) can read
 *     and accept an invitation sent to their email (user_own_invitations
 *     policy 0009) and the membership write is scoped to the invitation's org
 *   - Members list returns the user's name/email (findMembersByOrgId)
 *
 * @see AGENTS.md §9 — Definition of done (integration tests)
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

import { TransactionManager } from '../../apps/api/src/core/database/transaction-manager.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { DrizzleInvitationRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-invitation.repository.js';
import { DrizzleUserRepository } from '../../apps/api/src/platform/users/infrastructure/repositories/drizzle-user.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import { InviteUserUseCase } from '../../apps/api/src/platform/memberships/application/invite-user.use-case.js';
import { AcceptInvitationUseCase } from '../../apps/api/src/platform/memberships/application/accept-invitation.use-case.js';
import { RevokeInvitationUseCase } from '../../apps/api/src/platform/memberships/application/revoke-invitation.use-case.js';
import { UpdateMembershipRoleUseCase } from '../../apps/api/src/platform/memberships/application/update-membership-role.use-case.js';
import { RemoveMemberUseCase } from '../../apps/api/src/platform/memberships/application/remove-member.use-case.js';

/**
 * Minimal JwtTokenService stub for use cases that revoke sessions after a
 * successful mutation (AUTHZ-5 stale-claims window). Session revocation is
 * best-effort and out of scope for these DB-focused integration tests.
 */
function sessionRevokerStub(): { revokeAllUserSessions: () => Promise<void>; revokeSession: () => Promise<void> } {
  return {
    revokeAllUserSessions: async () => undefined,
    revokeSession: async () => undefined,
  };
}

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

let container: StartedTestContainer;
let db: PostgresJsDatabase;
let ownerSql: postgres.Sql;
let appClient: postgres.Sql;
let ownerUserId: string;
let inviteeUserId: string;
const INVITEE_EMAIL = 'invitee@example.com';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16')
    .withUsername('modubiz_owner')
    .withPassword('modubiz_owner_password')
    .withDatabase('modubiz_test')
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

  // Real user rows are required (membership + invitation have FKs to core_users).
  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'owner@example.com'}, ${'hash'}, ${'Owner User'})
  `;
  inviteeUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${inviteeUserId}, ${INVITEE_EMAIL}, ${'hash'}, ${'Invitee User'})
  `;

  appClient = postgres(appConnString);
  db = drizzle(appClient, { logger: false });
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (appClient) await appClient.end();
  if (container) await container.stop();
});

const ownerContext: TenantContextData = {
  userId: '',
  organizationId: undefined,
  roles: [],
  permissions: [],
  locale: 'en',
};

/** Create an org as the owner and return the owner role id inside it. */
async function createOrgForOwner(): Promise<{ orgId: string; ownerRoleId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `inv-${randomUUID().slice(0, 8)}`;

  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Invite Org ${slug}`,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );

  const [roleRow] = await ownerSql`
    SELECT id FROM core_roles WHERE organization_id = ${result.organization.id} AND key = 'owner' LIMIT 1
  `;

  return { orgId: result.organization.id, ownerRoleId: roleRow?.id as string };
}

/** Look up a seeded system-role id inside an org (AUTH-10 seeds all five). */
async function systemRoleId(orgId: string, key: string): Promise<string> {
  const [row] = await ownerSql`
    SELECT id FROM core_roles WHERE organization_id = ${orgId} AND key = ${key} LIMIT 1
  `;
  return row?.id as string;
}

/** Invite the shared invitee into an org and accept the invitation. */
async function addInviteeMember(orgId: string, roleId: string): Promise<{ membershipId: string }> {
  const membershipRepo = new DrizzleMembershipRepository(db);
  const invitationRepo = new DrizzleInvitationRepository(db);
  const userRepo = new DrizzleUserRepository(db);
  const txManager = new TransactionManager(db);
  const inviteUseCase = new InviteUserUseCase(membershipRepo, invitationRepo, userRepo, txManager);
  const acceptUseCase = new AcceptInvitationUseCase(membershipRepo, invitationRepo, userRepo, txManager);

  const { invitationId } = await TenantContext.run(
    { ...ownerContext, userId: ownerUserId, organizationId: orgId },
    () =>
      inviteUseCase.execute({
        name: 'Invitee User',
        email: INVITEE_EMAIL,
        roleId,
        organizationId: orgId,
        invitedBy: ownerUserId,
      }),
  );
  await TenantContext.run({ ...ownerContext, userId: inviteeUserId }, () =>
    acceptUseCase.execute({ invitationId, userId: inviteeUserId }),
  );

  const [membershipRow] = await ownerSql`
    SELECT id FROM core_memberships WHERE organization_id = ${orgId} AND user_id = ${inviteeUserId}
  `;
  return { membershipId: membershipRow?.id as string };
}

describe('InviteUserUseCase / AcceptInvitationUseCase (integration)', () => {
  it('AUTH-3/AUTH-9: invite → accept → membership, member list shows name/email', async () => {
    const { orgId, ownerRoleId } = await createOrgForOwner();
    const membershipRepo = new DrizzleMembershipRepository(db);
    const invitationRepo = new DrizzleInvitationRepository(db);
    const userRepo = new DrizzleUserRepository(db);
    const txManager = new TransactionManager(db);
    const inviteUseCase = new InviteUserUseCase(membershipRepo, invitationRepo, userRepo, txManager);
    const acceptUseCase = new AcceptInvitationUseCase(membershipRepo, invitationRepo, userRepo, txManager);

    // Invite as the owner (tenant context WITH an org).
    const { invitationId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        inviteUseCase.execute({
          // migration 0012: the inviter types the invitee name, which rides
          // through to the invitations list + public invite page
          name: 'Invitee User',
          email: INVITEE_EMAIL,
          roleId: ownerRoleId,
          organizationId: orgId,
          invitedBy: ownerUserId,
        }),
    );

    // The invitation row exists and is pending — and carries the invitee name
    // the inviter typed (migration 0012): the invitations list + public invite
    // page show it.
    const [invRow] = await ownerSql`
      SELECT name, email, accepted_at FROM core_invitations WHERE id = ${invitationId}
    `;
    expect(invRow?.name).toBe('Invitee User');
    expect(invRow?.email).toBe(INVITEE_EMAIL);
    expect(invRow?.accepted_at).toBeNull();

    // AUTH-3: accepting an invitation implicitly verifies the invitee's email.
    // Assert the null → Date transition explicitly (a pre-verified user would
    // make the post-accept check vacuous).
    const [userRow] = await ownerSql`
      SELECT email_verified_at FROM core_users WHERE id = ${inviteeUserId}
    `;
    expect(userRow?.email_verified_at).toBeNull();

    await TenantContext.run({ ...ownerContext, userId: inviteeUserId }, () =>
      acceptUseCase.execute({ invitationId, userId: inviteeUserId }),
    );

    const [verifiedRow] = await ownerSql`
      SELECT email_verified_at FROM core_users WHERE id = ${inviteeUserId}
    `;
    expect(verifiedRow?.email_verified_at).not.toBeNull();

    // Membership created with the invited role; invitation marked accepted.
    const [membershipRow] = await ownerSql`
      SELECT user_id, role_id, status FROM core_memberships
      WHERE organization_id = ${orgId} AND user_id = ${inviteeUserId}
    `;
    expect(membershipRow?.user_id).toBe(inviteeUserId);
    expect(membershipRow?.role_id).toBe(ownerRoleId);
    expect(membershipRow?.status).toBe('active');

    const [acceptedRow] = await ownerSql`
      SELECT accepted_at FROM core_invitations WHERE id = ${invitationId}
    `;
    expect(acceptedRow?.accepted_at).not.toBeNull();

    // The members list returns both members with name + email (no UUIDs).
    const members = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      txManager.run((tx) => membershipRepo.findMembersByOrgId(orgId, tx)),
    );

    const ownerMember = members.find((m) => m.userId === ownerUserId);
    const inviteeMember = members.find((m) => m.userId === inviteeUserId);
    expect(ownerMember?.userName).toBe('Owner User');
    expect(ownerMember?.userEmail).toBe('owner@example.com');
    expect(inviteeMember?.userName).toBe('Invitee User');
    expect(inviteeMember?.userEmail).toBe(INVITEE_EMAIL);
  });

  it('AUTHZ-8: rejects inviting an email that already has an active membership', async () => {
    const { orgId } = await createOrgForOwner();
    const membershipRepo = new DrizzleMembershipRepository(db);
    const invitationRepo = new DrizzleInvitationRepository(db);
    const userRepo = new DrizzleUserRepository(db);
    const txManager = new TransactionManager(db);
    const inviteUseCase = new InviteUserUseCase(membershipRepo, invitationRepo, userRepo, txManager);

    // The owner is already a member — inviting their email must be rejected.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        inviteUseCase.execute({
          name: 'Owner',
          email: 'owner@example.com',
          roleId: '',
          organizationId: orgId,
          invitedBy: ownerUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_ALREADY_EXISTS' });
  });

  it('AUTHZ-8: rejects a duplicate pending invitation for the same email', async () => {
    const { orgId, ownerRoleId } = await createOrgForOwner();
    const membershipRepo = new DrizzleMembershipRepository(db);
    const invitationRepo = new DrizzleInvitationRepository(db);
    const userRepo = new DrizzleUserRepository(db);
    const txManager = new TransactionManager(db);
    const inviteUseCase = new InviteUserUseCase(membershipRepo, invitationRepo, userRepo, txManager);

    const invite = () =>
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        inviteUseCase.execute({
          name: 'Invitee User',
          email: INVITEE_EMAIL,
          roleId: ownerRoleId,
          organizationId: orgId,
          invitedBy: ownerUserId,
        }),
      );

    await invite();
    await expect(invite()).rejects.toMatchObject({ code: 'INVITATION_ALREADY_PENDING' });
  });

  it('AUTH-10: org creation seeds all five system roles (dropdown regression)', async () => {
    const { orgId } = await createOrgForOwner();

    const roleRows = await ownerSql`
      SELECT key FROM core_roles WHERE organization_id = ${orgId} ORDER BY key
    `;
    expect(roleRows.map((r) => r.key as string)).toEqual(['admin', 'manager', 'member', 'owner', 'viewer']);
  });

  it('AUTHZ-1/AUTHZ-3: owner can change a member role inside the tenant transaction (RLS regression)', async () => {
    const { orgId, ownerRoleId } = await createOrgForOwner();
    const memberRoleId = await systemRoleId(orgId, 'member');
    const viewerRoleId = await systemRoleId(orgId, 'viewer');

    const { membershipId } = await addInviteeMember(orgId, memberRoleId);

    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const updateRoleUseCase = new UpdateMembershipRoleUseCase(membershipRepo, txManager, sessionRevokerStub());

    // Owner re-roles the invitee to viewer. Regression: the pre-fix
    // findById ran OUTSIDE the tenant-bound transaction, RLS failed closed,
    // and this threw MEMBERSHIP_NOT_FOUND (404 → "no longer part of the
    // organization") even though the membership exists.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      updateRoleUseCase.execute({
        membershipId,
        newRoleId: viewerRoleId,
        newRoleKey: '',
        currentUserId: ownerUserId,
        currentUserRoleKey: 'owner',
        organizationId: orgId,
      }),
    );

    const [afterRow] = await ownerSql`
      SELECT role_id FROM core_memberships WHERE id = ${membershipId}
    `;
    expect(afterRow?.role_id).toBe(viewerRoleId);

    // AUTHZ-2: a NON-owner (here the invitee holding the member role) cannot
    // demote the OWNER — ownership is OWNER-managed. The actor is someone
    // OTHER than the owner because a user demoting their OWN membership trips
    // AUTHZ-3 (CANNOT_CHANGE_OWN_ROLE) first.
    const [ownerMembership] = await ownerSql`
      SELECT id FROM core_memberships WHERE organization_id = ${orgId} AND user_id = ${ownerUserId}
    `;
    await expect(
      TenantContext.run({ ...ownerContext, userId: inviteeUserId, organizationId: orgId }, () =>
        updateRoleUseCase.execute({
          membershipId: ownerMembership?.id as string,
          newRoleId: memberRoleId,
          newRoleKey: '',
          currentUserId: inviteeUserId,
          currentUserRoleKey: 'member',
          organizationId: orgId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'ONLY_OWNER_CAN_DEMOTE' });

    // AUTHZ-3: a user cannot change their own role.
    await expect(
      TenantContext.run({ ...ownerContext, userId: inviteeUserId, organizationId: orgId }, () =>
        updateRoleUseCase.execute({
          membershipId,
          newRoleId: ownerRoleId,
          newRoleKey: '',
          currentUserId: inviteeUserId,
          currentUserRoleKey: 'member',
          organizationId: orgId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CANNOT_CHANGE_OWN_ROLE' });
  });

  it('AUTHZ-2: an ADMIN cannot demote or remove an OWNER even when another owner exists', async () => {
    const { orgId } = await createOrgForOwner();
    const adminRoleId = await systemRoleId(orgId, 'admin');
    const memberRoleId = await systemRoleId(orgId, 'member');

    // Second owner + an admin (distinct people) so the last-owner guard is
    // NOT the reason the demotion/removal fails — AUTHZ-2 must be.
    const { membershipId: adminMembershipId } = await addInviteeMember(orgId, adminRoleId);

    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const updateRoleUseCase = new UpdateMembershipRoleUseCase(membershipRepo, txManager, sessionRevokerStub());
    const removeUseCase = new RemoveMemberUseCase(membershipRepo, txManager, sessionRevokerStub());

    const [ownerMembership, secondOwner] = await ownerSql`
      SELECT id FROM core_memberships WHERE organization_id = ${orgId} AND user_id = ${ownerUserId}
    `;
    void ownerMembership;

    // Promote a second user to OWNER so the org has 2 owners → the admin's
    // demotion attempt cannot be blamed on the last-owner guard.
    const secondOwnerUserId = randomUUID();
    await ownerSql`
      INSERT INTO core_users (id, email, password_hash, name)
      VALUES (${secondOwnerUserId}, ${'second-owner@example.com'}, ${'hash'}, ${'Second Owner'})
    `;
    const ownerRoleId = await systemRoleId(orgId, 'owner');
    await ownerSql`
      INSERT INTO core_memberships (id, organization_id, user_id, role_id, status, joined_at, created_at, updated_at)
      VALUES (${randomUUID()}, ${orgId}, ${secondOwnerUserId}, ${ownerRoleId}, 'active', NOW(), NOW(), NOW())
    `;

    // ADMIN attempts to demote the OWNER → ONLY_OWNER_CAN_DEMOTE (AUTHZ-2).
    const [ownerMembershipRow] = await ownerSql`
      SELECT id FROM core_memberships WHERE organization_id = ${orgId} AND user_id = ${ownerUserId}
    `;
    await expect(
      TenantContext.run({ ...ownerContext, userId: inviteeUserId, organizationId: orgId }, () =>
        updateRoleUseCase.execute({
          membershipId: ownerMembershipRow?.id as string,
          newRoleId: memberRoleId,
          newRoleKey: '',
          currentUserId: inviteeUserId,
          currentUserRoleKey: 'admin',
          organizationId: orgId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'ONLY_OWNER_CAN_DEMOTE' });

    // ADMIN attempts to remove the OWNER → ONLY_OWNER_CAN_REMOVE (AUTHZ-2).
    await expect(
      TenantContext.run({ ...ownerContext, userId: inviteeUserId, organizationId: orgId }, () =>
        removeUseCase.execute({
          membershipId: ownerMembershipRow?.id as string,
          organizationId: orgId,
          currentUserId: inviteeUserId,
          currentUserRoleKey: 'admin',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ONLY_OWNER_CAN_REMOVE' });

    // Sanity: the ADMIN's own membership is untouched by the failed attempts.
    const [adminRow] = await ownerSql`
      SELECT role_id, deleted_at FROM core_memberships WHERE id = ${adminMembershipId}
    `;
    expect(adminRow?.role_id).toBe(adminRoleId);
    expect(adminRow?.deleted_at).toBeNull();
  });

  it('AUTHZ-1/AUTHZ-7: removing a member soft-deletes inside the tenant transaction (RLS regression)', async () => {
    const { orgId } = await createOrgForOwner();
    const memberRoleId = await systemRoleId(orgId, 'member');

    const { membershipId } = await addInviteeMember(orgId, memberRoleId);

    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const removeUseCase = new RemoveMemberUseCase(membershipRepo, txManager, sessionRevokerStub());

    // Regression: the pre-fix findById ran OUTSIDE the tenant transaction,
    // so removal also 404'd. A member holding the 'member' role is freely
    // removable (AUTHZ-1 protects only the last OWNER).
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      removeUseCase.execute({
        membershipId,
        organizationId: orgId,
        currentUserId: ownerUserId,
      }),
    );

    const [afterRow] = await ownerSql`
      SELECT status, deleted_at FROM core_memberships WHERE id = ${membershipId}
    `;
    expect(afterRow?.status).toBe('inactive');
    expect(afterRow?.deleted_at).not.toBeNull();

    // AUTHZ-1: the last OWNER cannot be removed. The actor IS an owner (passing
    // their roleKey) so the AUTHZ-2 OWNER-manages-OWNER guard does not fire
    // first — the LAST-OWNER guard is the reason this fails.
    const [ownerMembership] = await ownerSql`
      SELECT id FROM core_memberships WHERE organization_id = ${orgId} AND user_id = ${ownerUserId}
    `;
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        removeUseCase.execute({
          membershipId: ownerMembership?.id as string,
          organizationId: orgId,
          currentUserId: ownerUserId,
          currentUserRoleKey: 'owner',
        }),
      ),
    ).rejects.toMatchObject({ code: 'LAST_OWNER_CANNOT_REMOVE' });
  });

  it('AUTHZ-5: switch-org tokens embed role key + effective permissions; a member lacks member-management perms', async () => {
    const { orgId } = await createOrgForOwner();
    const memberRoleId = await systemRoleId(orgId, 'member');
    const { membershipId } = await addInviteeMember(orgId, memberRoleId);

    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);

    // Resolve the MEMBER role's effective permissions (the role stored on the
    // invitee's membership). System-role permissions are code-defined.
    const memberRole = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      txManager.run((tx) => membershipRepo.resolveRolePermissions(orgId, memberRoleId, tx)),
    );
    expect(memberRole?.roleKey).toBe('member');
    expect(memberRole?.permissions).not.toContain('platform:members:assign-role');
    expect(memberRole?.permissions).not.toContain('platform:members:invite');
    expect(memberRole?.permissions).not.toContain('platform:members:remove');

    // Regression (AUTHZ-5): the pre-fix switch-org minted tokens with
    // roles:[] + permissions:[], so PermissionGuard had nothing to check and
    // a member could change any member's role. Now the member's own role
    // resolution must NOT include member-management permissions.
    expect(memberRole).not.toBeUndefined();
    expect(membershipId).toBeTruthy();
  });

  it('AUTHZ-5: role resolution for switch-org works from an ORG-LESS token context (RLS regression — empty-claims bug)', async () => {
    const { orgId, ownerRoleId } = await createOrgForOwner();
    const memberRoleId = await systemRoleId(orgId, 'member');

    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);

    // Regression for the login → auto-select → switch-org browser flow: a
    // freshly signed-in user's token carries NO organizationId, so
    // txManager.run() binds only app.current_user_id. core_roles is protected
    // by the ORG-based tenant_isolation policy (no user_own_* equivalent), so
    // resolveRolePermissions must run inside runWithOrg(orgId) or it fails
    // closed → undefined → the minted token gets roles:[] + permissions:[]
    // even for an OWNER (sidebar Members/Roles/Billing regression).
    const failClosed = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      txManager.run((tx) => membershipRepo.resolveRolePermissions(orgId, ownerRoleId, tx)),
    );
    expect(failClosed).toBeUndefined();

    // The fix: runWithOrg binds app.current_organization_id to the target org,
    // making the role row visible — the owner resolves with the system flag.
    const ownerRole = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      txManager.runWithOrg(orgId, (tx) => membershipRepo.resolveRolePermissions(orgId, ownerRoleId, tx)),
    );
    expect(ownerRole?.roleKey).toBe('owner');
    expect(ownerRole?.isSystem).toBe(true);

    // Sanity: the member role also resolves org-bound (SwitchOrgUseCase maps
    // SYSTEM_ROLE_PERMISSIONS from the key, so a member gets no management
    // perms in the minted token).
    const memberRole = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      txManager.runWithOrg(orgId, (tx) => membershipRepo.resolveRolePermissions(orgId, memberRoleId, tx)),
    );
    expect(memberRole?.roleKey).toBe('member');
    expect(memberRole?.isSystem).toBe(true);
  });

  it('AUTHZ-8/AUTH-9: a revoked invitation can be re-invited and its link can no longer be accepted', async () => {
    const { orgId } = await createOrgForOwner();
    const memberRoleId = await systemRoleId(orgId, 'member');

    const membershipRepo = new DrizzleMembershipRepository(db);
    const invitationRepo = new DrizzleInvitationRepository(db);
    const userRepo = new DrizzleUserRepository(db);
    const txManager = new TransactionManager(db);
    const inviteUseCase = new InviteUserUseCase(membershipRepo, invitationRepo, userRepo, txManager);
    const revokeUseCase = new RevokeInvitationUseCase(invitationRepo, txManager);

    // Invite the invitee (not yet a member).
    const { invitationId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        inviteUseCase.execute({
          name: 'Invitee User',
          email: INVITEE_EMAIL,
          roleId: memberRoleId,
          organizationId: orgId,
          invitedBy: ownerUserId,
        }),
    );

    // Revoke it (owner has the invite permission).
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      revokeUseCase.execute({ invitationId, organizationId: orgId }),
    );

    const [revokedRow] = await ownerSql`
      SELECT revoked_at FROM core_invitations WHERE id = ${invitationId}
    `;
    expect(revokedRow?.revoked_at).not.toBeNull();

    // AUTHZ-8: a re-invite is now allowed (the revoked invitation is no
    // longer "pending", so INVITATION_ALREADY_PENDING does not fire).
    const { invitationId: reInviteId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        inviteUseCase.execute({
          name: 'Invitee User',
          email: INVITEE_EMAIL,
          roleId: memberRoleId,
          organizationId: orgId,
          invitedBy: ownerUserId,
        }),
    );
    expect(reInviteId).not.toBe(invitationId);

    // AUTH-9: the REVOKED invitation's link can no longer be accepted.
    const acceptUseCase = new AcceptInvitationUseCase(membershipRepo, invitationRepo, userRepo, txManager);
    await expect(
      TenantContext.run({ ...ownerContext, userId: inviteeUserId }, () =>
        acceptUseCase.execute({ invitationId, userId: inviteeUserId }),
      ),
    ).rejects.toMatchObject({ code: 'INVITATION_REVOKED' });

    // The NEW invitation still accepts normally.
    await TenantContext.run({ ...ownerContext, userId: inviteeUserId }, () =>
      acceptUseCase.execute({ invitationId: reInviteId, userId: inviteeUserId }),
    );
    const [membershipRow] = await ownerSql`
      SELECT id FROM core_memberships WHERE organization_id = ${orgId} AND user_id = ${inviteeUserId}
    `;
    expect(membershipRow).toBeDefined();
  });

  it('AUTHZ-7: a removed member can be re-invited and re-accepted (partial-unique regression, was HTTP 500)', async () => {
    const { orgId } = await createOrgForOwner();
    const memberRoleId = await systemRoleId(orgId, 'member');
    const viewerRoleId = await systemRoleId(orgId, 'viewer');

    // 1) Invite + accept → active membership.
    const { membershipId } = await addInviteeMember(orgId, memberRoleId);

    // 2) Owner removes the member → soft delete (AUTHZ-7).
    const membershipRepo = new DrizzleMembershipRepository(db);
    const invitationRepo = new DrizzleInvitationRepository(db);
    const userRepo = new DrizzleUserRepository(db);
    const txManager = new TransactionManager(db);
    const removeUseCase = new RemoveMemberUseCase(membershipRepo, txManager, sessionRevokerStub());

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      removeUseCase.execute({
        membershipId,
        organizationId: orgId,
        currentUserId: ownerUserId,
        currentUserRoleKey: 'owner',
      }),
    );

    // 3) Re-invite the SAME email (AUTHZ-8 allows it — the old membership is
    //    soft-deleted, so findByUserAndOrg finds nothing active).
    const inviteUseCase = new InviteUserUseCase(membershipRepo, invitationRepo, userRepo, txManager);
    const acceptUseCase = new AcceptInvitationUseCase(membershipRepo, invitationRepo, userRepo, txManager);

    const { invitationId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        inviteUseCase.execute({
          name: 'Invitee User',
          email: INVITEE_EMAIL,
          roleId: viewerRoleId,
          organizationId: orgId,
          invitedBy: ownerUserId,
        }),
    );

    // 4) Re-accept as the invitee (token has NO org — RLS policy 0009).
    //    Regression: the pre-fix hard UNIQUE (organization_id, user_id) made
    //    this INSERT collide with the soft-deleted row → HTTP 500.
    await TenantContext.run({ ...ownerContext, userId: inviteeUserId }, () =>
      acceptUseCase.execute({ invitationId, userId: inviteeUserId }),
    );

    // Both rows exist: the old soft-deleted one and a NEW active one.
    const rows = await ownerSql`
      SELECT status, deleted_at, role_id FROM core_memberships
      WHERE organization_id = ${orgId} AND user_id = ${inviteeUserId}
      ORDER BY created_at
    `;
    expect(rows.length).toBe(2);
    const [oldRow, newRow] = rows as Array<{ status: string; deleted_at: Date | null; role_id: string }>;
    expect(oldRow?.status).toBe('inactive');
    expect(oldRow?.deleted_at).not.toBeNull();
    expect(newRow?.status).toBe('active');
    expect(newRow?.deleted_at).toBeNull();
    // Re-accept uses the NEW invitation's role.
    expect(newRow?.role_id).toBe(viewerRoleId);

    // The members list exposes exactly one active membership for the invitee.
    const members = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      txManager.run((tx) => membershipRepo.findMembersByOrgId(orgId, tx)),
    );
    expect(members.filter((m) => m.userId === inviteeUserId)).toHaveLength(1);
  });
});
