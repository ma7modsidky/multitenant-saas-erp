import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth/auth.module.js';
import { AuthController, UsersController } from './api/index.js';
import {
  SignupUseCase,
  LoginUseCase,
  RefreshTokenUseCase,
  PasswordResetUseCase,
  PasswordChangeUseCase,
  SessionManagementUseCase,
} from './application/index.js';
import { DrizzleUserRepository } from './infrastructure/repositories/drizzle-user.repository.js';
import { USER_REPOSITORY } from './ports/index.js';

/**
 * UsersModule — platform module for user identity and authentication flows.
 *
 * Provides:
 *   - Signup (AUTH-1, AUTH-2, AUTH-3)
 *   - Login with rate-limiting (AUTH-7, AUTH-8)
 *   - Token refresh with rotation (AUTH-4)
 *   - Password reset (AUTH-9)
 *   - Password change with session revocation (AUTH-6)
 *   - Session management (AUTH-5)
 *
 * Auth routes are system-context (no tenant required).
 * User routes require JWT authentication.
 *
 * @see PLAN.md §2.3
 * @see BUSINESS_RULES.md — AUTH-1 through AUTH-9
 */
@Module({
  imports: [AuthModule],
  controllers: [AuthController, UsersController],
  providers: [
    // Repository
    {
      provide: USER_REPOSITORY,
      useClass: DrizzleUserRepository,
    },
    // Use cases
    SignupUseCase,
    LoginUseCase,
    RefreshTokenUseCase,
    PasswordResetUseCase,
    PasswordChangeUseCase,
    SessionManagementUseCase,
  ],
  exports: [USER_REPOSITORY, SignupUseCase, LoginUseCase],
})
export class UsersModule {}
