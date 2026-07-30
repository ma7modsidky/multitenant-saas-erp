import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { type Session, type SessionStore } from './session-store.interface.js';

/**
 * InMemorySessionStore — in-memory implementation of SessionStore.
 *
 * Used for development and testing. Will be replaced by a Redis-backed
 * or database-backed store in Phase 2+ for production use.
 *
 * All session data is stored in a Map and lost on process restart.
 *
 * Reuse detection strategy:
 *   When a refresh token is rotated, the OLD hash is NOT removed from the
 *   index. Instead, the old hash continues to point to the session. When
 *   a rotated token is later presented, findByRefreshTokenHash returns
 *   the session, and the caller can detect reuse by comparing
 *   session.refreshTokenHash !== tokenHash (the session now has a different
 *   current hash). The old hash entry acts as a "previous hash" index.
 *
 * @see AUTH-4 — Refresh token rotation and reuse detection
 * @see AUTH-5 — Sessions are listable and individually revocable
 */
@Injectable()
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly refreshTokenHashIndex = new Map<string, string>();

  async create(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    this.refreshTokenHashIndex.set(session.refreshTokenHash, session.id);
  }

  async findByRefreshTokenHash(hash: string): Promise<Session | undefined> {
    const sessionId = this.refreshTokenHashIndex.get(hash);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  async findByUserId(userId: string): Promise<Session[]> {
    const userSessions: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        userSessions.push(session);
      }
    }
    return userSessions;
  }

  async findById(sessionId: string): Promise<Session | undefined> {
    return this.sessions.get(sessionId);
  }

  async revoke(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.revokedAt = new Date().toISOString();
    session.revokeReason = reason ?? null;
  }

  async revokeFamily(tokenFamily: string, reason?: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.tokenFamily === tokenFamily && !session.revokedAt) {
        session.revokedAt = new Date().toISOString();
        session.revokeReason = reason ?? null;
      }
    }
  }

  async revokeAllForUser(userId: string, reason?: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = new Date().toISOString();
        session.revokeReason = reason ?? null;
      }
    }
  }

  /**
   * Update the refresh token hash for a session (during rotation).
   *
   * The OLD hash is KEPT in the index so that reuse detection can still
   * find the session when a rotated token is later presented. The old hash
   * is also saved as previousRefreshTokenHash on the session for auditing.
   */
  async updateRefreshTokenHash(sessionId: string, newHash: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Save the old hash as previous hash for reuse detection
    session.previousRefreshTokenHash = session.refreshTokenHash;

    // Update the current hash
    session.refreshTokenHash = newHash;

    // Add new hash index (old hash still exists for reuse detection)
    this.refreshTokenHashIndex.set(newHash, sessionId);
  }
}
