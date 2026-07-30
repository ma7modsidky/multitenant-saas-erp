import { describe, expect, it } from 'vitest';

import { PasswordService } from '../password.service.js';

const VALID_PASSWORD = 'MySecureP@ssw0rd!';
const SHORT_PASSWORD = 'abc';
const LONG_PASSWORD = 'A'.repeat(128);

describe('PasswordService', () => {
  const service = new PasswordService();

  describe('hash', () => {
    it('AUTH-2: returns a hash string for a valid password', async () => {
      const hash = await service.hash(VALID_PASSWORD);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      // argon2id hashes start with $argon2id$
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('AUTH-2: produces different hashes for the same password (unique salt)', async () => {
      const hash1 = await service.hash(VALID_PASSWORD);
      const hash2 = await service.hash(VALID_PASSWORD);

      expect(hash1).not.toBe(hash2);
    });

    it('handles short passwords without error', async () => {
      const hash = await service.hash(SHORT_PASSWORD);
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('handles long passwords without error', async () => {
      const hash = await service.hash(LONG_PASSWORD);
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('handles empty string passwords', async () => {
      // Note: AUTH-2 requires minimum 12 chars, but that's enforced at
      // the application/validation layer, not in PasswordService itself.
      const hash = await service.hash('');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('handles passwords with special characters', async () => {
      const hash = await service.hash('p@ss wörd 日本語 🎉!');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('handles numeric passwords', async () => {
      const hash = await service.hash('123456789012');
      expect(hash).toMatch(/^\$argon2id\$/);
    });
  });

  describe('verify', () => {
    it('AUTH-2: returns true for a matching password', async () => {
      const hash = await service.hash(VALID_PASSWORD);
      const result = await service.verify(hash, VALID_PASSWORD);

      expect(result).toBe(true);
    });

    it('AUTH-2: returns false for an incorrect password', async () => {
      const hash = await service.hash(VALID_PASSWORD);
      const result = await service.verify(hash, 'WrongPassword123!');

      expect(result).toBe(false);
    });

    it('returns false for an empty password against a non-empty hash', async () => {
      const hash = await service.hash(VALID_PASSWORD);
      const result = await service.verify(hash, '');

      expect(result).toBe(false);
    });

    it('returns false for a password against an unrelated hash', async () => {
      const hash1 = await service.hash('Password1!');
      const result = await service.verify(hash1, 'Password2@');

      expect(result).toBe(false);
    });
  });
});
