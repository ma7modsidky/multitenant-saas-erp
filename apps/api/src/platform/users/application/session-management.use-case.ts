import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { type Session } from '../../../core/auth/session-store.interface.js';
import { USER_NOT_FOUND } from '../domain/errors.js';

/**
 * SessionManagementUseCase — lists and revokes user sessions (AUTH-5).
 *
 * Business rules:
 * - AUTH-5: Sessions are listable by the user and individually revocable
 */
@Injectable()
export class SessionManagementUseCase {
  constructor(
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  /**
   * List all active sessions for a user.
   */
  async listSessions(userId: string): Promise<Session[]> {
    return this.jwtTokenService.listSessions(userId);
  }

  /**
   * Revoke a specific session (AUTH-5).
   *
   * @param userId - The user ID (verified by caller)
   * @param sessionId - The session ID to revoke
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.jwtTokenService.revokeSession(sessionId, 'USER_REVOKED');
  }
}
