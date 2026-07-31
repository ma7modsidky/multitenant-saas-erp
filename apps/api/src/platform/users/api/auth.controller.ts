import {
  Body,
  Controller,
  Post,
  UsePipes,
  Headers,
} from '@nestjs/common';

import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import {
  SignupUseCase,
  LoginUseCase,
  RefreshTokenUseCase,
  PasswordResetUseCase,
} from '../application/index.js';
import {
  signupSchema,
  loginSchema,
  refreshTokenSchema,
  requestPasswordResetSchema,
  completePasswordResetSchema,
  buildAuthResponse,
  type SignupDto,
  type LoginDto,
  type RefreshTokenDto,
  type RequestPasswordResetDto,
  type CompletePasswordResetDto,
  type AuthResponse,
} from './dto/index.js';

/**
 * AuthController — system-context authentication endpoints.
 *
 * All routes are marked @PublicRoute() — they do NOT require authentication
 * or tenant context. This is necessary because these operations happen
 * before the user has a session.
 *
 * Route prefix: /v1/auth
 */
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly signupUseCase: SignupUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly passwordResetUseCase: PasswordResetUseCase,
  ) {}

  /**
   * POST /v1/auth/signup
   * Register a new user account.
   */
  @Post('signup')
  @PublicRoute()
  @UsePipes(new ZodValidationPipe(signupSchema))
  async signup(@Body() dto: SignupDto): Promise<{ data: { message: string } }> {
    await this.signupUseCase.execute({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      ...(dto.preferredLocale !== undefined ? { preferredLocale: dto.preferredLocale } : {}),
    } as any); // DTO was Zod-validated at the boundary

    return {
      data: {
        message: 'Account created. Please verify your email to continue.',
      },
    };
  }

  /**
   * POST /v1/auth/login
   * Authenticate with email and password.
   */
  @Post('login')
  @PublicRoute()
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ): Promise<{ data: AuthResponse }> {
    const ip = forwardedFor?.split(',')[0]?.trim();

    const result = await this.loginUseCase.execute({
      email: dto.email,
      password: dto.password,
      // userAgent is the fallback; dto.device takes priority
      ...(userAgent !== undefined ? { device: userAgent } : {}),
      ...(dto.device !== undefined ? { device: dto.device } : {}),
      ...(ip !== undefined ? { ip } : {}),
    } as any); // DTO was Zod-validated at the boundary

    return {
      data: buildAuthResponse(result.accessToken, result.refreshToken, result.user),
    };
  }

  /**
   * POST /v1/auth/refresh
   * Refresh an access token using a refresh token (rotation, AUTH-4).
   */
  @Post('refresh')
  @PublicRoute()
  @UsePipes(new ZodValidationPipe(refreshTokenSchema))
  async refresh(@Body() dto: RefreshTokenDto): Promise<{ data: { accessToken: string; refreshToken: string } }> {
    const result = await this.refreshTokenUseCase.execute({
      refreshToken: dto.refreshToken,
    });

    return { data: result };
  }

  /**
   * POST /v1/auth/request-password-reset
   * Request a password reset email.
   */
  @Post('request-password-reset')
  @PublicRoute()
  @UsePipes(new ZodValidationPipe(requestPasswordResetSchema))
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<{ data: { message: string } }> {
    await this.passwordResetUseCase.requestReset({ email: dto.email });

    return {
      data: {
        message: 'If the email exists, a reset link has been sent.',
      },
    };
  }

  /**
   * POST /v1/auth/complete-password-reset
   * Complete a password reset with the token from the email (AUTH-9).
   */
  @Post('complete-password-reset')
  @PublicRoute()
  @UsePipes(new ZodValidationPipe(completePasswordResetSchema))
  async completePasswordReset(@Body() dto: CompletePasswordResetDto): Promise<{ data: { message: string } }> {
    await this.passwordResetUseCase.completeReset({
      email: dto.email,
      resetToken: dto.resetToken,
      newPassword: dto.newPassword,
    });

    return {
      data: { message: 'Password has been reset successfully.' },
    };
  }
}
