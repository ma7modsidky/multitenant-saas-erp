import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError, DomainError } from '../../../core/common/errors.js';
import { PasswordService } from '../../../core/auth/password.service.js';
import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { User, AUTH_INVALID_CREDENTIALS } from '../domain/index.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/index.js';

/**
 * Input for changing a password.
 */
export interface PasswordChangeInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

/**
 * PasswordChangeUseCase — changes the user's password (AUTH-6).
 *
 * Business rules:
 * - AUTH-6: Changing password revokes all sessions for the user immediately
 * - Current password must be verified before allowing the change
 */
@Injectable()
export class PasswordChangeUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  async execute(input: PasswordChangeInput): Promise<void> {
    const userData = await this.userRepo.findById(input.userId);

    if (!userData) {
      throw new NotFoundError('USER_NOT_FOUND', { userId: input.userId });
    }

    const user = User.fromPersistence(userData);

    // Verify current password (AUTH-2)
    const passwordValid = await this.passwordService.verify(user.passwordHash, input.currentPassword);
    if (!passwordValid) {
      throw new DomainError(AUTH_INVALID_CREDENTIALS, 'Current password is incorrect');
    }

    // Hash new password (AUTH-2)
    const newPasswordHash = await this.passwordService.hash(input.newPassword);

    // Update password and revoke all sessions (AUTH-6)
    await this.userRepo.update(input.userId, { passwordHash: newPasswordHash });
    await this.jwtTokenService.revokeAllUserSessions(input.userId, 'PASSWORD_CHANGED');
  }
}
