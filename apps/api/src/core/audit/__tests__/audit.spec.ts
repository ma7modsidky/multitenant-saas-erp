import { describe, expect, it, beforeEach } from 'vitest';

import { AuditLogger, redactSensitiveFields } from '../audit-logger.js';

// ─── Redaction (AUD-3) ──────────────────────────────────────────────────────

describe('AUD-3: Sensitive fields are redacted', () => {
  it('AUD-3: redacts password fields', () => {
    const input = { name: 'John', password: 'super-secret-123', email: 'john@example.com' };
    const result = redactSensitiveFields(input);

    expect(result).toEqual({
      name: 'John',
      password: '[REDACTED]',
      email: 'john@example.com',
    });
  });

  it('AUD-3: redacts token fields', () => {
    const input = { accessToken: 'eyJhbGci...', refreshToken: 'rft_abc123' };
    const result = redactSensitiveFields(input);

    expect(result).toEqual({
      accessToken: '[REDACTED]',
      refreshToken: '[REDACTED]',
    });
  });

  it('AUD-3: redacts nested sensitive fields', () => {
    const input = {
      user: { name: 'John', password: 'secret' },
      metadata: { apiKey: 'sk-123' },
    };
    const result = redactSensitiveFields(input);

    expect(result).toEqual({
      user: { name: 'John', password: '[REDACTED]' },
      metadata: { apiKey: '[REDACTED]' },
    });
  });

  it('AUD-3: redacts sensitive fields in arrays', () => {
    const input = {
      items: [
        { name: 'User 1', password: 'secret1' },
        { name: 'User 2', password: 'secret2' },
      ],
    };
    const result = redactSensitiveFields(input);

    expect(result).toEqual({
      items: [
        { name: 'User 1', password: '[REDACTED]' },
        { name: 'User 2', password: '[REDACTED]' },
      ],
    });
  });

  it('AUD-3: returns null/undefined unchanged', () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });

  it('AUD-3: preserves non-sensitive fields exactly', () => {
    const input = { name: 'John', email: 'john@example.com', role: 'ADMIN' };
    const result = redactSensitiveFields(input);

    expect(result).toEqual(input);
  });

  it('AUD-3: handles card number fields', () => {
    const input = { cardNumber: '4111-1111-1111-1111', cvv: '123', name: 'John' };
    const result = redactSensitiveFields(input);

    expect(result).toEqual({
      cardNumber: '[REDACTED]',
      cvv: '[REDACTED]',
      name: 'John',
    });
  });

  it('AUD-3: handles empty objects', () => {
    const result = redactSensitiveFields({});
    expect(result).toEqual({});
  });

  it('AUD-3: stops recursion at MAX_REDACT_DEPTH (10 levels)', () => {
    // Build 15 levels of { nested: ... } wrapping { password: 'secret123' }

    let input: any = { password: 'secret123' };
    for (let i = 0; i < 15; i++) {
      input = { nested: input };
    }

    const result = redactSensitiveFields(input);

    // Navigate 10 levels deep — still inside the processed wrapper
    // Recursion stops at depth 10, so depth 10+ returns data as-is

    let current: any = result;
    for (let i = 0; i < 10; i++) {
      current = current?.nested;
    }
    expect(current).toBeDefined();

    // Navigate 5 more levels to reach the core { password: 'secret123' }
    for (let i = 0; i < 5; i++) {
      current = current?.nested;
    }
    // The password field was never redacted because recursion stopped
    // at depth 10 before reaching this level
    expect(current?.password).toBe('secret123');
  });

  it('AUD-3: handles arrays with deeply nested objects at depth boundary', () => {
    // Build an array with objects at depth 9 (approaching MAX_REDACT_DEPTH)

    let deeplyNested: any = { password: 'secret123' };
    for (let i = 0; i < 8; i++) {
      deeplyNested = { nested: deeplyNested };
    }

    const input = {
      items: [deeplyNested],
    };

    const result = redactSensitiveFields(input);

    // The password field should be redacted because depth 9 < MAX_REDACT_DEPTH
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, no-restricted-syntax
    let current: any = (result as any)?.items?.[0];
    for (let i = 0; i < 8; i++) {
      current = current?.nested;
    }
    expect(current?.password).toBe('[REDACTED]');
  });

  it('AUD-3: preserves primitive values in arrays without modification', () => {
    const input = { ids: [1, 2, 3], names: ['a', 'b', 'c'], flags: [true, false] };
    const result = redactSensitiveFields(input);

    expect(result).toEqual(input);
  });

  it('AUD-3: handles mixed null/undefined values in the object', () => {
    const input = {
      name: 'John',
      password: null, // sensitive field with null value
      token: undefined, // sensitive field with undefined value
      email: 'john@example.com',
    };
    const result = redactSensitiveFields(input);

    expect(result).toEqual({
      name: 'John',
      password: '[REDACTED]',
      token: '[REDACTED]',
      email: 'john@example.com',
    });
  });

  it('AUD-3: handles array items that are null or undefined', () => {
    const input = {
      users: [{ name: 'Alice', password: 'alice-secret' }, null, undefined, { name: 'Bob', apiKey: 'bob-key' }],
    };
    const result = redactSensitiveFields(input);

    expect(result).toEqual({
      users: [{ name: 'Alice', password: '[REDACTED]' }, null, undefined, { name: 'Bob', apiKey: '[REDACTED]' }],
    });
  });
});

// ─── AuditLogger (AUD-1) ────────────────────────────────────────────────────

describe('AUD-1: AuditLogger records mutating operations', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  it('AUD-1: records a create operation with all required fields', async () => {
    const entry = await logger.record({
      actorId: 'user-1',
      actorEmail: 'admin@example.com',
      action: 'CREATE',
      entityType: 'user',
      entityId: 'user-2',
      organizationId: 'org-1',
      before: null,
      after: { name: 'New User', email: 'new@example.com', role: 'MEMBER' },
      ipAddress: '192.168.1.1',
      correlationId: 'corr-123',
    });

    expect(entry.id).toBeDefined();
    expect(entry.actorId).toBe('user-1');
    expect(entry.actorEmail).toBe('admin@example.com');
    expect(entry.action).toBe('CREATE');
    expect(entry.entityType).toBe('user');
    expect(entry.entityId).toBe('user-2');
    expect(entry.organizationId).toBe('org-1');
    expect(entry.ipAddress).toBe('192.168.1.1');
    expect(entry.correlationId).toBe('corr-123');
    expect(entry.occurredAt).toBeDefined();
    expect(new Date(entry.occurredAt).getTime()).not.toBeNaN();
  });

  it('AUD-1: records an update operation with before/after state', async () => {
    const entry = await logger.record({
      actorId: 'user-1',
      actorEmail: 'admin@example.com',
      action: 'UPDATE',
      entityType: 'organization',
      entityId: 'org-1',
      before: { name: 'Old Name', locale: 'en' },
      after: { name: 'New Name', locale: 'ar' },
    });

    expect(entry.action).toBe('UPDATE');
    expect(entry.before).toEqual({ name: 'Old Name', locale: 'en' });
    expect(entry.after).toEqual({ name: 'New Name', locale: 'ar' });
  });

  it('AUD-1: records a delete operation', async () => {
    const entry = await logger.record({
      actorId: 'user-1',
      actorEmail: 'admin@example.com',
      action: 'DELETE',
      entityType: 'user',
      entityId: 'user-2',
      before: { name: 'Deleted User', deletedAt: null },
      after: null,
    });

    expect(entry.action).toBe('DELETE');
  });

  it('AUD-1: redacts sensitive fields before storing', async () => {
    const entry = await logger.record({
      actorId: 'user-1',
      actorEmail: 'admin@example.com',
      action: 'CREATE',
      entityType: 'user',
      entityId: 'user-3',
      before: null,
      after: { name: 'John', password: 'secret123', email: 'john@example.com' },
    });

    expect(entry.after).toEqual({
      name: 'John',
      password: '[REDACTED]',
      email: 'john@example.com',
    });
  });

  it('AUD-1: generates unique IDs for each entry', async () => {
    const entry1 = await logger.record({
      actorId: 'user-1',
      actorEmail: 'a@b.com',
      action: 'OTHER',
      entityType: 'test',
      entityId: '1',
    });
    const entry2 = await logger.record({
      actorId: 'user-1',
      actorEmail: 'a@b.com',
      action: 'OTHER',
      entityType: 'test',
      entityId: '2',
    });

    expect(entry1.id).not.toBe(entry2.id);
  });

  it('AUD-1: records the correct timestamp on creation', async () => {
    const before = new Date();
    const entry = await logger.record({
      actorId: 'user-1',
      actorEmail: 'a@b.com',
      action: 'LOGIN',
      entityType: 'session',
      entityId: 'sess-1',
    });
    const after = new Date();

    const entryTime = new Date(entry.occurredAt).getTime();
    expect(entryTime).toBeGreaterThanOrEqual(before.getTime());
    expect(entryTime).toBeLessThanOrEqual(after.getTime());
  });
});

// ─── Query functionality ────────────────────────────────────────────────────

describe('AuditLogger.query', () => {
  let logger: AuditLogger;

  beforeEach(async () => {
    logger = new AuditLogger();
    // Seed some entries
    const entries = [
      {
        actorId: 'user-1',
        actorEmail: 'a@b.com',
        action: 'CREATE' as const,
        entityType: 'user',
        entityId: 'u1',
        organizationId: 'org-1',
      },
      {
        actorId: 'user-1',
        actorEmail: 'a@b.com',
        action: 'UPDATE' as const,
        entityType: 'user',
        entityId: 'u1',
        organizationId: 'org-1',
      },
      {
        actorId: 'user-2',
        actorEmail: 'b@c.com',
        action: 'CREATE' as const,
        entityType: 'org',
        entityId: 'org-2',
        organizationId: 'org-2',
      },
      {
        actorId: 'user-1',
        actorEmail: 'a@b.com',
        action: 'DELETE' as const,
        entityType: 'user',
        entityId: 'u2',
        organizationId: 'org-1',
      },
    ];

    for (const entry of entries) {
      await logger.record(entry);
    }
  });

  it('returns all entries when no filters are applied', async () => {
    const result = await logger.query({});
    expect(result.total).toBe(4);
    expect(result.entries).toHaveLength(4);
  });

  it('filters by actorId', async () => {
    const result = await logger.query({ actorId: 'user-1' });
    expect(result.total).toBe(3);
  });

  it('filters by action', async () => {
    const result = await logger.query({ action: 'CREATE' });
    expect(result.total).toBe(2);
  });

  it('filters by org', async () => {
    const result = await logger.query({ organizationId: 'org-2' });
    expect(result.total).toBe(1);
    expect(result.entries[0]!.actorId).toBe('user-2');
  });

  it('filters by entity type and id', async () => {
    const result = await logger.query({ entityType: 'user', entityId: 'u1' });
    expect(result.total).toBe(2);
  });

  it('paginates results', async () => {
    const result = await logger.query({ limit: 2, offset: 0 });
    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(4);
  });

  it('returns entries sorted by most recent first', async () => {
    const result = await logger.query({});
    // Entries are in order of insertion, newest last
    expect(result.entries[0]!.entityId).toBe('u2'); // most recent
    expect(result.entries[3]!.entityId).toBe('u1'); // oldest
  });

  it('returns empty array when no entries match', async () => {
    const result = await logger.query({ actorId: 'nonexistent' });
    expect(result.total).toBe(0);
    expect(result.entries).toHaveLength(0);
  });
});

// ─── Entry count ────────────────────────────────────────────────────────────

describe('AuditLogger.entryCount', () => {
  it('starts at 0', () => {
    const logger = new AuditLogger();
    expect(logger.entryCount).toBe(0);
  });

  it('increments with each entry', async () => {
    const logger = new AuditLogger();
    await logger.record({
      actorId: 'u1',
      actorEmail: 'a@b.com',
      action: 'OTHER',
      entityType: 'test',
      entityId: '1',
    });
    expect(logger.entryCount).toBe(1);

    await logger.record({
      actorId: 'u1',
      actorEmail: 'a@b.com',
      action: 'OTHER',
      entityType: 'test',
      entityId: '2',
    });
    expect(logger.entryCount).toBe(2);
  });
});
