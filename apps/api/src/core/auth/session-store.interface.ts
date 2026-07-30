/**
 * A refresh token session.
 */
export interface Session {
  /** Unique session identifier */
  id: string;
  /** User ID who owns this session */
  userId: string;
  /** Token family identifier for rotation tracking */
  tokenFamily: string;
  /** Hash of the current refresh token */
  refreshTokenHash: string;
  /** Hash of the previous refresh token (for reuse detection after rotation) */
  previousRefreshTokenHash: string | null;
  /** Device/client identifier */
  device: string | undefined;
  /** IP address at session creation */
  ip: string | undefined;
  /** Session expiry timestamp (ISO 8601) */
  expiresAt: string;
  /** When the session was created */
  createdAt: string;
  /** When the session was revoked (null if active) */
  revokedAt: string | null;
  /** Reason for revocation (null if active) */
  revokeReason: string | null;
}

/**
 * SessionStore — interface for persisting refresh token sessions.
 *
 * Implementations:
 *   - InMemorySessionStore (current): for development and testing
 *   - RedisSessionStore (Phase 2+): production, with auto-expiry via TTL
 *   - DatabaseSessionStore (Phase 2+): uses core_sessions table
 *
 * @see AUTH-5 — Sessions are listable and individually revocable
 */
export interface SessionStore {
  /**
   * Create a new session.
   */
  create(session: Session): Promise<void>;

  /**
   * Find a session by its refresh token hash.
   * Used during token rotation to verify the presented refresh token.
   * Should check both current and previous hashes for reuse detection.
   */
  findByRefreshTokenHash(hash: string): Promise<Session | undefined>;

  /**
   * Find all active sessions for a user.
   * Used for the "list active sessions" feature.
   */
  findByUserId(userId: string): Promise<Session[]>;

  /**
   * Find a session by its ID.
   */
  findById(sessionId: string): Promise<Session | undefined>;

  /**
   * Revoke a single session.
   */
  revoke(sessionId: string, reason?: string): Promise<void>;

  /**
   * Revoke all sessions in a token family.
   * Called when refresh token reuse is detected (AUTH-4).
   */
  revokeFamily(tokenFamily: string, reason?: string): Promise<void>;

  /**
   * Revoke all sessions for a user.
   * Called on password change (AUTH-6).
   */
  revokeAllForUser(userId: string, reason?: string): Promise<void>;

  /**
   * Update the refresh token hash for a session (during rotation).
   * Must save the old hash as previousRefreshTokenHash so reuse detection
   * can still find the session when a rotated token is presented.
   */
  updateRefreshTokenHash(sessionId: string, newHash: string): Promise<void>;
}
