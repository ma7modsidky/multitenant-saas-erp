import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { DomainError } from '../../../core/common/errors.js';
import { PasswordService } from '../../../core/auth/password.service.js';
import { User, AUTH_INVALID_RESET_TOKEN } from '../domain/index.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/index.js';

/**
 * Input for requesting a password reset.
 */
export interface RequestPasswordResetInput {
  email: string;
}

/**
 * Input for completing a password reset.
 */
export interface CompletePasswordResetInput {
  email: string;
  resetToken: string;
  newPassword: string;
}

/**
 * PasswordResetUseCase — handles both requesting and completing password reset (AUTH-9).
 *
 * Business rules:
 * - AUTH-9: Reset tokens are single-use, 60-min expiry, stored hashed
 *
 * NOTE: Token persistence is in-memory (temporary). Phase 2+ will use
 * a dedicated password_reset_tokens table for durability.
 */
@Injectable()
export class PasswordResetUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Request a password reset — generates a reset token and stores its hash.
   * Always returns success to prevent email enumeration (AUTH-8 principle).
   */
  async requestReset(input: RequestPasswordResetInput): Promise<{ resetToken: string }> {
    const normalizedEmail = User.normalizeEmail(input.email);
    const userData = await this.userRepo.findByEmail(normalizedEmail);

    // Always succeed — don't reveal if email exists
    if (!userData) {
      return { resetToken: 'noop-token' };
    }

    const resetToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const resetTokenHash = this.hashToken(resetToken);
    const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes

    this.pendingResets.set(resetTokenHash, {
      userId: userData.id,
      expiresAt: resetTokenExpiresAt,
      used: false,
    });

    return { resetToken };
  }

  /**
   * Complete a password reset — validates the token and updates the password.
   */
  async completeReset(input: CompletePasswordResetInput): Promise<void> {
    const normalizedEmail = User.normalizeEmail(input.email);
    const userData = await this.userRepo.findByEmail(normalizedEmail);

    if (!userData) {
      throw new DomainError(AUTH_INVALID_RESET_TOKEN, 'Invalid or expired reset token');
    }

    const tokenHash = this.hashToken(input.resetToken);
    const resetData = this.pendingResets.get(tokenHash);

    if (!resetData || resetData.used || resetData.userId !== userData.id || new Date() > resetData.expiresAt) {
      throw new DomainError(AUTH_INVALID_RESET_TOKEN, 'Invalid or expired reset token');
    }

    // Mark token as used (single-use — AUTH-9)
    resetData.used = true;

    // Hash new password
    const newPasswordHash = await this.passwordService.hash(input.newPassword);

    // Update password
    await this.userRepo.update(userData.id, { passwordHash: newPasswordHash });
  }

  // ─── Token storage (temporary in-memory; will move to DB in Phase 2+) ───

  private readonly pendingResets = new Map<string, { userId: string; expiresAt: Date; used: boolean }>();

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
