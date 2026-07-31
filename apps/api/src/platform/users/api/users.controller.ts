import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { NotFoundError } from '../../../core/common/errors.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  PasswordChangeUseCase,
  SessionManagementUseCase,
} from '../application/index.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/index.js';
import {
  passwordChangeSchema,
  updateProfileSchema,
  type PasswordChangeDto,
  type UpdateProfileDto,
  type SessionResponse,
  type UserProfileResponse,
} from './dto/index.js';

/**
 * UsersController — authenticated user management endpoints.
 *
 * All endpoints require JWT authentication.
 *
 * Route prefix: /v1/users
 */
@Controller('v1/users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly passwordChangeUseCase: PasswordChangeUseCase,
    private readonly sessionManagementUseCase: SessionManagementUseCase,
  ) {}

  /**
   * GET /v1/users/me
   * Get the current user's profile.
   */
  @Get('me')
  async getProfile(): Promise<{ data: UserProfileResponse }> {
    const userId = TenantContext.requireUserId();
    const userData = await this.userRepo.findById(userId);

    if (!userData) {
      throw new NotFoundError('USER_NOT_FOUND', { userId });
    }

    return {
      data: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        preferredLocale: userData.preferredLocale,
        emailVerified: userData.emailVerifiedAt !== null,
        createdAt: userData.createdAt.toISOString(),
      },
    };
  }

  /**
   * PATCH /v1/users/me
   * Update the current user's profile.
   */
  @Patch('me')
  @UsePipes(new ZodValidationPipe(updateProfileSchema))
  async updateProfile(
    @Body() dto: UpdateProfileDto,
  ): Promise<{ data: UserProfileResponse }> {
    const userId = TenantContext.requireUserId();
    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.preferredLocale !== undefined) updateData.preferredLocale = dto.preferredLocale;

    const updated = await this.userRepo.update(userId, updateData as any);

    return {
      data: {
        id: userId,
        email: updated?.email ?? '',
        name: updated?.name ?? '',
        preferredLocale: updated?.preferredLocale ?? null,
        emailVerified: updated?.emailVerifiedAt !== null,
        createdAt: updated?.createdAt?.toISOString() ?? new Date().toISOString(),
      },
    };
  }

  /**
   * POST /v1/users/me/change-password
   * Change password and revoke all other sessions (AUTH-6).
   */
  @Post('me/change-password')
  @UsePipes(new ZodValidationPipe(passwordChangeSchema))
  async changePassword(@Body() dto: PasswordChangeDto): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();

    await this.passwordChangeUseCase.execute({
      userId,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });

    return {
      data: { message: 'Password changed. All other sessions have been revoked.' },
    };
  }

  /**
   * GET /v1/users/me/sessions
   * List all active sessions for the current user (AUTH-5).
   */
  @Get('me/sessions')
  async listSessions(): Promise<{ data: SessionResponse[] }> {
    const userId = TenantContext.requireUserId();
    const sessions = await this.sessionManagementUseCase.listSessions(userId);

    return {
      data: sessions.map((s) => ({
        id: s.id,
        device: s.device ?? undefined,
        ip: s.ip ?? undefined,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        current: false,
      })),
    };
  }

  /**
   * DELETE /v1/users/me/sessions/:id
   * Revoke a specific session (AUTH-5).
   */
  @Delete('me/sessions/:id')
  async revokeSession(@Param('id') sessionId: string): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();
    await this.sessionManagementUseCase.revokeSession(userId, sessionId);

    return {
      data: { message: 'Session revoked.' },
    };
  }
}
