import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Invitation, InvitationError, INVITATION_NOT_FOUND, type InvitationData } from '../domain/index.js';
import { INVITATION_REPOSITORY, type InvitationRepository } from '../ports/index.js';

/**
 * RevokeInvitationUseCase — revokes a pending invitation (AUTH-9, AUTHZ-8).
 *
 * Business rules:
 * - Only an invitation that is still PENDING can be revoked; an accepted or
 *   already-revoked invitation is rejected (409) — the domain entity enforces
 *   this via Invitation.revoke().
 * - The invitation must belong to the caller's organization; anything else is
 *   a 404 (RLS fails closed, and we never reveal another org's rows).
 *
 * RLS notes:
 * - core_invitations is org-scoped RLS; the read and the write both run inside
 *   the tenant-bound transaction so the org context is bound.
 */
@Injectable()
export class RevokeInvitationUseCase {
  constructor(
    @Inject(INVITATION_REPOSITORY)
    private readonly invitationRepo: InvitationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { invitationId: string; organizationId: string }): Promise<void> {
    // The read must run inside the tenant transaction (core_invitations has
    // org-scoped RLS; a pool read fails closed to zero rows — TEN-3).
    const invitationData: InvitationData | undefined = await this.txManager.run((tx) =>
      this.invitationRepo.findById(input.invitationId, tx),
    );

    if (!invitationData || invitationData.organizationId !== input.organizationId) {
      throw new NotFoundError(INVITATION_NOT_FOUND, { invitationId: input.invitationId });
    }

    await this.txManager.run(async (tx) => {
      const invitation = Invitation.fromPersistence(invitationData);

      try {
        invitation.revoke();
      } catch (err) {
        // Domain state-machine rejections map to 409 (ConflictError) so the
        // API returns a machine-readable code the UI can render. The entity's
        // revoke() only throws INVITATION_ALREADY_REVOKED / INVITATION_ALREADY_ACCEPTED,
        // so the code is propagated as-is.
        if (err instanceof InvitationError) {
          throw new ConflictError(err.code, err.message);
        }
        throw err;
      }

      await this.invitationRepo.update(input.invitationId, { revokedAt: invitation.revokedAt }, tx);
    });
  }
}
