import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * PasswordService — handles password hashing and verification.
 *
 * Uses argon2id (the recommended variant of Argon2) with default parameters:
 *   - Memory cost: 64MB
 *   - Time cost: 3 iterations
 *   - Parallelism: 4 threads
 *
 * These parameters provide strong resistance against GPU-based attacks
 * while keeping hashing fast enough for interactive use (< 500ms).
 *
 * @see AUTH-2 — Password hashing uses argon2id
 * @see TECH_STACK.md §2 — Approved utility set includes argon2
 */
@Injectable()
export class PasswordService {
  /**
   * Hash a plaintext password using argon2id.
   *
   * @param password - The plaintext password to hash
   * @returns The argon2id hash string (includes salt and parameters)
   */
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MiB
      timeCost: 3,
      parallelism: 4,
      hashLength: 32,
    });
  }

  /**
   * Verify a password against an argon2id hash.
   *
   * @param hash - The argon2id hash to verify against
   * @param password - The plaintext password to verify
   * @returns True if the password matches the hash
   */
  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
