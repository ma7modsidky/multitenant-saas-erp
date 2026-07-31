import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import { PasswordService } from '../../../core/auth/password.service.js';
import { User, USER_EMAIL_TAKEN } from '../domain/index.js';
import { type UserData } from '../domain/user.entity.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/index.js';

/**
 * Input for user signup.
 */
export interface SignupInput {
  email: string;
  password: string;
  name: string;
  preferredLocale?: string;
}

/**
 * Result of a successful signup.
 */
export interface SignupOutput {
  user: User;
}

/**
 * SignupUseCase — creates a new user account with an argon2id-hashed password.
 *
 * Business rules:
 * - AUTH-1: Email is normalized (trimmed, lowercased) and checked for uniqueness
 * - AUTH-2: Password is hashed with argon2id (delegated to PasswordService)
 * - AUTH-3: Email verification is required before org creation (handled later)
 *
 * Does NOT create an organization — that happens in a separate step (signup flow).
 */
@Injectable()
export class SignupUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly passwordService: PasswordService,
  ) {}

  async execute(input: SignupInput): Promise<SignupOutput> {
    const normalizedEmail = User.normalizeEmail(input.email);

    // Check email uniqueness (AUTH-1)
    const emailTaken = await this.userRepo.isEmailTaken(normalizedEmail);
    if (emailTaken) {
      throw new ConflictError(USER_EMAIL_TAKEN, 'Email is already registered', { email: normalizedEmail });
    }

    // Hash password with argon2id (AUTH-2)
    const passwordHash = await this.passwordService.hash(input.password);

    // Create user entity
    const userData: UserData = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      passwordHash,
      name: input.name,
      preferredLocale: input.preferredLocale ?? null,
      emailVerifiedAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const persisted = await this.userRepo.insert(userData);

    return { user: User.fromPersistence(persisted) };
  }
}
