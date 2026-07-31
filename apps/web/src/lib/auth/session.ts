// Session storage for the web app.
//
// Tokens are kept in memory + localStorage as a Phase 2 interim measure
// (see CODING_STANDARDS.md §12 — httpOnly cookies land in a later phase).
//
// A non-sensitive `modubiz_authed` cookie mirrors the auth state so the
// Next.js middleware can guard routes (middleware cannot read localStorage).

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  preferredLocale: string | null;
  emailVerified: boolean;
}

const TOKENS_KEY = 'modubiz.tokens';
const USER_KEY = 'modubiz.user';
export const AUTH_COOKIE = 'modubiz_authed';

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Best-effort base64 JWT payload decode. Returns null for malformed tokens.
 * Used only to read claims like `organizationId` — never for validation.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function'
      ? decodeURIComponent(
          Array.from(atob(base64))
            .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
            .join(''),
        )
      : Buffer.from(base64, 'base64').toString('utf-8');
    // JSON.parse returns `any`; the caller narrows against the known claim shape.
    // eslint-disable-next-line no-restricted-syntax -- unavoidable boundary cast at the JSON boundary
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    // JSON.parse returns `any`; the caller validates the shape before use.
    // eslint-disable-next-line no-restricted-syntax -- unavoidable boundary cast at the JSON boundary
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked — the session simply won't persist across reloads.
  }
}

function removeKey(key: string): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export const sessionStore = {
  getTokens(): StoredTokens | null {
    return readJson<StoredTokens>(TOKENS_KEY);
  },

  setTokens(tokens: StoredTokens): void {
    writeJson(TOKENS_KEY, tokens);
  },

  getAccessToken(): string | null {
    return this.getTokens()?.accessToken ?? null;
  },

  getRefreshToken(): string | null {
    return this.getTokens()?.refreshToken ?? null;
  },

  getUser(): StoredUser | null {
    return readJson<StoredUser>(USER_KEY);
  },

  setUser(user: StoredUser): void {
    writeJson(USER_KEY, user);
  },

  /**
   * The active organization id from the access token payload, if any.
   */
  getOrganizationId(): string | null {
    const token = this.getAccessToken();
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    const orgId = payload?.organizationId;
    return typeof orgId === 'string' && orgId.length > 0 ? orgId : null;
  },

  getPermissions(): string[] {
    const token = this.getAccessToken();
    if (!token) return [];
    const payload = decodeJwtPayload(token);
    const perms = payload?.permissions;
    return Array.isArray(perms) ? perms.filter((p): p is string => typeof p === 'string') : [];
  },

  clear(): void {
    removeKey(TOKENS_KEY);
    removeKey(USER_KEY);
  },
};

/**
 * Mirror auth state to a non-sensitive cookie so middleware can guard routes.
 */
export function setAuthedCookie(authed: boolean): void {
  if (typeof document === 'undefined') return;
  const value = authed ? '1' : '';
  const maxAge = authed ? 60 * 60 * 24 * 30 : 0;
  document.cookie = `${AUTH_COOKIE}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
}

/**
 * Tiny auth event bus. Components subscribe to react to session changes:
 * - `tokens`   emitted after a successful token refresh (token rotation)
 * - `expired`  emitted when the session can no longer be refreshed
 */
type AuthEvents = {
  tokens: (tokens: StoredTokens) => void;
  expired: () => void;
};

type AuthEventName = keyof AuthEvents;

const listeners: Partial<Record<AuthEventName, Set<(...args: never[]) => void>>> = {};

export const authEvents = {
  on<K extends AuthEventName>(name: K, handler: AuthEvents[K]): () => void {
    const bucket = (listeners[name] ??= new Set());
    bucket.add(handler);
    return () => {
      bucket.delete(handler);
    };
  },

  emit<K extends AuthEventName>(name: K, ...args: Parameters<AuthEvents[K]>): void {
    const bucket = listeners[name];
    if (!bucket) return;
    for (const listener of [...bucket]) {
      // The bucket stores generic handlers; the name-keyed emit narrows the arity.
      // eslint-disable-next-line no-restricted-syntax -- unavoidable dispatch cast across handler arities
      (listener as (...a: Parameters<AuthEvents[K]>) => void)(...args);
    }
  },
};
