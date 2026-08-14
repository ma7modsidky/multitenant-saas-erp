import { Inject, Injectable } from '@nestjs/common';

import { DomainError, UnauthorizedError } from '../../../core/common/errors.js';
import { PasswordService } from '../../../core/auth/password.service.js';
import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { User, AUTH_INVALID_CREDENTIALS, AUTH_ACCOUNT_LOCKED } from '../domain/index.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/index.js';

/**
 * Input for user login.
 */
export interface LoginInput {
  email: string;
  password: string;
  device?: string;
  ip?: string;
}

/**
 * Result of a successful login.
 */
export interface LoginOutput {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/**
 * LoginUseCase — authenticates a user by email and password (AUTH-8).
 *
 * Business rules:
 * - AUTH-7: Rate-limited; 10 failures ⇒ temporary 15-min lock
 * - AUTH-8: Always returns AUTH_INVALID_CREDENTIALS (never reveals if email exists)
 * - AUTH-4: Issues access + refresh tokens on success
 */
@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    const normalizedEmail = User.normalizeEmail(input.email);
    const userData = await this.userRepo.findByEmail(normalizedEmail);

    // AUTH-8: Always return generic error — never reveal if email exists
    if (!userData) {
      // Fake verify to prevent timing attacks (keeps response time constant).
      // argon2.verify() can throw if the hash is structurally invalid; we catch
      // any thrown error and proceed to throw AUTH_INVALID_CREDENTIALS regardless.
      await this.passwordService
        .verify(
          // A structurally valid argon2id hash whose password will never match
          '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG',
          input.password,
        )
        .catch(() => undefined);
      throw new UnauthorizedError(AUTH_INVALID_CREDENTIALS);
    }

    const user = User.fromPersistence(userData);

    // Check if account is locked (AUTH-7)
    if (user.isLocked) {
      throw new DomainError(AUTH_ACCOUNT_LOCKED, 'Account temporarily locked due to too many failed attempts');
    }

    // Verify password (AUTH-2)
    const passwordValid = await this.passwordService.verify(user.passwordHash, input.password);

    if (!passwordValid) {
      // Record failed attempt (AUTH-7)
      user.recordFailedLogin();
      await this.userRepo.update(user.id, {
        failedLoginAttempts: user.failedLoginAttempts,
        lockedUntil: user.lockedUntil,
      });

      throw new UnauthorizedError(AUTH_INVALID_CREDENTIALS);
    }

    // Success — reset failure counter
    user.recordSuccessfulLogin();
    await this.userRepo.update(user.id, { failedLoginAttempts: 0, lockedUntil: null });

    // Generate refresh token first so the session exists and its ID can be
    // embedded in the access token (AUTH-5 current-session marking). The
    // session records the platform-admin flag (PLT-1) so a refresh re-mints
    // the same claim.
    const { refreshToken, session } = await this.jwtTokenService.generateRefreshToken(user.id, input.device, input.ip, {
      isPlatformAdmin: userData.isPlatformAdmin,
    });

    // Generate tokens (AUTH-4)
    const accessToken = await this.jwtTokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      sessionId: session.id,
      organizationId: undefined,
      roles: [],
      permissions: [],
      isPlatformAdmin: userData.isPlatformAdmin,
    });

    return { accessToken, refreshToken, user };
  }
}
