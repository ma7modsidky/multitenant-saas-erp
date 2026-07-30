import { describe, expect, it, beforeEach } from 'vitest';

import { InMemorySessionStore } from '../session-store.js';
import { type Session } from '../session-store.interface.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'sess-1',
    userId: overrides.userId ?? 'user-1',
    tokenFamily: overrides.tokenFamily ?? 'family-1',
    refreshTokenHash: overrides.refreshTokenHash ?? 'hash-current',
    previousRefreshTokenHash: overrides.previousRefreshTokenHash ?? null,
    device: overrides.device ?? undefined,
    ip: overrides.ip ?? undefined,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86400000).toISOString(),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    revokedAt: overrides.revokedAt ?? null,
    revokeReason: overrides.revokeReason ?? null,
  };
}

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  // ─── Edge cases: Missing session ───────────────────────────────────────

  describe('edge cases — missing session', () => {
    it('findById returns undefined for non-existent session', async () => {
      const result = await store.findById('does-not-exist');
      expect(result).toBeUndefined();
    });

    it('findByRefreshTokenHash returns undefined for unknown hash', async () => {
      const result = await store.findByRefreshTokenHash('unknown-hash');
      expect(result).toBeUndefined();
    });

    it('revoke silently succeeds for non-existent session', async () => {
      await store.revoke('does-not-exist', 'TEST');
      // No throw = success
    });

    it('updateRefreshTokenHash silently succeeds for non-existent session', async () => {
      await store.updateRefreshTokenHash('does-not-exist', 'new-hash');
      // No throw = success
    });

    it('findByUserId returns empty array for user with no sessions', async () => {
      const result = await store.findByUserId('no-sessions-user');
      expect(result).toEqual([]);
    });
  });

  // ─── revokeFamily edge cases ───────────────────────────────────────────

  describe('revokeFamily', () => {
    it('revokes all sessions in a family that are not already revoked', async () => {
      const session1 = makeSession({ id: 's1', userId: 'user-1', tokenFamily: 'fam-1', refreshTokenHash: 'h1' });
      const session2 = makeSession({ id: 's2', userId: 'user-1', tokenFamily: 'fam-1', refreshTokenHash: 'h2' });
      const session3 = makeSession({ id: 's3', userId: 'user-2', tokenFamily: 'fam-2', refreshTokenHash: 'h3' });

      await store.create(session1);
      await store.create(session2);
      await store.create(session3);

      // Revoke one session in fam-1 first
      await store.revoke('s1', 'MANUAL');

      // Now revokeFamily should revoke only session2 (session1 already revoked)
      await store.revokeFamily('fam-1', 'TOKEN_REUSE');

      const s1 = await store.findById('s1'); // already revoked
      const s2 = await store.findById('s2'); // should be freshly revoked
      const s3 = await store.findById('s3'); // different family — untouched

      expect(s1?.revokedAt).not.toBeNull();
      expect(s1?.revokeReason).toBe('MANUAL');

      expect(s2?.revokedAt).not.toBeNull();
      expect(s2?.revokeReason).toBe('TOKEN_REUSE');

      expect(s3?.revokedAt).toBeNull();
      expect(s3?.revokeReason).toBeNull();
    });

    it('does nothing when no sessions match the token family', async () => {
      const session = makeSession({ id: 's1', tokenFamily: 'fam-1' });
      await store.create(session);

      await store.revokeFamily('non-existent-family');

      const s1 = await store.findById('s1');
      expect(s1?.revokedAt).toBeNull();
    });

    it('does nothing when all sessions in family are already revoked', async () => {
      const session = makeSession({ id: 's1', tokenFamily: 'fam-1', revokedAt: new Date().toISOString(), revokeReason: 'ALREADY' });
      await store.create(session);

      await store.revokeFamily('fam-1', 'TOKEN_REUSE');

      const s1 = await store.findById('s1');
      expect(s1?.revokeReason).toBe('ALREADY'); // unchanged
    });
  });

  // ─── revokeAllForUser edge cases ───────────────────────────────────────

  describe('revokeAllForUser', () => {
    it('does not revoke already-revoked sessions again', async () => {
      const session1 = makeSession({ id: 's1', userId: 'user-1', tokenFamily: 'fam-1', refreshTokenHash: 'h1' });
      const session2 = makeSession({ id: 's2', userId: 'user-1', tokenFamily: 'fam-2', refreshTokenHash: 'h2', revokedAt: new Date().toISOString(), revokeReason: 'OLD' });

      await store.create(session1);
      await store.create(session2);

      await store.revokeAllForUser('user-1', 'PASSWORD_CHANGED');

      const s1 = await store.findById('s1');
      const s2 = await store.findById('s2');

      expect(s1?.revokedAt).not.toBeNull();
      expect(s1?.revokeReason).toBe('PASSWORD_CHANGED');
      // s2 was already revoked and should keep its original reason
      expect(s2?.revokeReason).toBe('OLD');
    });

    it('does nothing when user has no sessions', async () => {
      await store.revokeAllForUser('non-existent-user');
      // No throw = success
    });
  });

  // ─── updateRefreshTokenHash edge cases ─────────────────────────────────

  describe('updateRefreshTokenHash', () => {
    it('updates the hash and keeps old hash index for reuse detection', async () => {
      const session = makeSession({ id: 's1', refreshTokenHash: 'old-hash' });
      await store.create(session);

      await store.updateRefreshTokenHash('s1', 'new-hash');

      // Old hash still finds the session (for reuse detection)
      const byOldHash = await store.findByRefreshTokenHash('old-hash');
      expect(byOldHash?.id).toBe('s1');

      // New hash also finds the session
      const byNewHash = await store.findByRefreshTokenHash('new-hash');
      expect(byNewHash?.id).toBe('s1');

      // Previous hash is recorded
      expect(byNewHash?.previousRefreshTokenHash).toBe('old-hash');

      // Current hash is updated
      expect(byNewHash?.refreshTokenHash).toBe('new-hash');
    });
  });
});
