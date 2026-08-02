/**
 * User entity data (persisted to core_users).
 *
 * core_users is a GLOBAL (non-tenant) table — it has no organization_id
 * column. Row visibility is governed by membership queries, not RLS.
 *
 * @see DATA_MODEL.md §4.1 — Global (non-tenant) tables
 */
export interface UserData {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  preferredLocale: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Number of consecutive failed login attempts (AUTH-7) */
  failedLoginAttempts: number;
  /** Timestamp when failed attempts counter was last reset or lock started */
  lockedUntil: Date | null;
}

/**
 * User — domain entity for registered users.
 *
 * A user represents an individual who can authenticate and belong to
 * one or more organizations through memberships.
 *
 * Business rules enforced:
 * - AUTH-1: Email is unique and stored normalized (trimmed, lowercased)
 * - AUTH-2: Password is hashed with argon2id (enforced by PasswordService)
 * - AUTH-3: Email must be verified before creating an organization
 * - AUTH-7: Login is rate-limited; 10 failures ⇒ temporary lock
 * - AUTH-8: Authentication failures return a generic code
 */
export class User {
  private constructor(private readonly data: UserData) {}

  static create(data: UserData): User {
    return new User(data);
  }

  static fromPersistence(data: UserData): User {
    return new User(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get email(): string {
    return this.data.email;
  }
  get passwordHash(): string {
    return this.data.passwordHash;
  }
  get name(): string {
    return this.data.name;
  }
  get preferredLocale(): string | null {
    return this.data.preferredLocale;
  }
  get emailVerifiedAt(): Date | null {
    return this.data.emailVerifiedAt;
  }
  get createdAt(): Date {
    return this.data.createdAt;
  }
  get updatedAt(): Date {
    return this.data.updatedAt;
  }
  get failedLoginAttempts(): number {
    return this.data.failedLoginAttempts;
  }
  get lockedUntil(): Date | null {
    return this.data.lockedUntil;
  }

  /** Whether the user's email has been verified (AUTH-3). */
  get isEmailVerified(): boolean {
    return this.data.emailVerifiedAt !== null;
  }

  /** Whether the account is currently locked (AUTH-7). */
  get isLocked(): boolean {
    if (!this.data.lockedUntil) return false;
    return new Date() < this.data.lockedUntil;
  }

  /** Get all data as a plain object. */
  toJSON(): UserData {
    return { ...this.data };
  }

  /**
   * Normalize an email address (trim, lowercase) — AUTH-1.
   */
  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  // ─── Authentication behaviours ─────────────────────────────────────────

  /**
   * Record a successful login — resets failure counter and lock.
   */
  recordSuccessfulLogin(): void {
    this.data.failedLoginAttempts = 0;
    this.data.lockedUntil = null;
  }

  /**
   * Record a failed login attempt (AUTH-7).
   * After 10 consecutive failures, locks the account for 15 minutes.
   *
   * @returns The current count of failed attempts
   */
  recordFailedLogin(): number {
    this.data.failedLoginAttempts += 1;

    // Lock after 10 consecutive failures (AUTH-7)
    if (this.data.failedLoginAttempts >= 10) {
      this.data.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    }

    return this.data.failedLoginAttempts;
  }

  /**
   * Verify the user's email (AUTH-3).
   */
  verifyEmail(): void {
    this.data.emailVerifiedAt = new Date();
  }

  /**
   * Update the user's password hash.
   *
   * @param newPasswordHash - The new argon2id hash
   */
  updatePasswordHash(newPasswordHash: string): void {
    this.data.passwordHash = newPasswordHash;
  }

  /**
   * Update profile information.
   */
  updateProfile(props: { name?: string; preferredLocale?: string | null }): void {
    if (props.name !== undefined) {
      this.data.name = props.name;
    }
    if (props.preferredLocale !== undefined) {
      this.data.preferredLocale = props.preferredLocale;
    }
  }
}
