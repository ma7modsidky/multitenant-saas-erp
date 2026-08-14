import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminBootstrapService } from '../application/bootstrap.service.js';

/** Reconstruct the raw SQL text of a drizzle fragment for assertions. */
function sqlText(fragment: unknown): string {
  const chunks = (fragment as SQL).queryChunks ?? [];
  const parts: string[] = [];
  const walk = (cs: unknown[]): void => {
    for (const chunk of cs) {
      const nested = (chunk as { queryChunks?: unknown[] }).queryChunks;
      if (nested) {
        walk(nested);
        continue;
      }
      const value = (chunk as { value?: string[] }).value;
      if (value) parts.push(...value);
    }
  };
  walk(chunks);
  return parts.join('');
}

/**
 * Regression guard (PLT-1): `syncPlatformAdmins` binds admin emails with the
 * explicit `ARRAY[...]::text[]` constructor instead of passing a JS array to
 * postgres-js as a single parameter. The old `ANY(${emails})` form was
 * serialized by postgres-js as a bare CSV string and crashed the whole app at
 * boot with `22P02: malformed array literal` (found during the live walkthrough).
 */
describe('AdminBootstrapService.syncPlatformAdmins (PLT-1)', () => {
  let config: { platformAdminEmails: string[]; trialDurationDays: number };
  let db: { execute: ReturnType<typeof vi.fn> };
  let service: AdminBootstrapService;

  beforeEach(() => {
    config = { platformAdminEmails: ['admin@modubiz.app'], trialDurationDays: 14 };
    db = {
      execute: vi.fn().mockImplementation(async (sql: unknown) => {
        // seedDefaultPricing reads the catalog; empty catalog = no pricing rows.
        if (String(sql).includes('FROM core_module_catalog')) return [];
        return [];
      }),
    };
    service = new AdminBootstrapService(config as never, db as never);
  });

  it('PLT-1: grants the flag via ARRAY[...]::text[] binding (never a bare JS array param)', async () => {
    await service.onApplicationBootstrap();

    const call = db.execute.mock.calls.find(([sqlFragment]) =>
      sqlText(sqlFragment).includes('is_platform_admin = true'),
    );
    expect(call).toBeDefined();
    const text = sqlText(call?.[0]);

    // The query must bind each email individually inside an array constructor —
    // `ANY(($1))` with a JS array param crashes postgres-js (22P02).
    expect(text).toContain('ARRAY[');
    expect(text).toContain('::text[]');
    expect(text).not.toContain('ANY((');
  });

  it('PLT-1: grants nothing when no admin emails are configured (no UPDATE emitted)', async () => {
    config.platformAdminEmails = [];
    await service.onApplicationBootstrap();

    const adminCalls = db.execute.mock.calls.filter(([sql]) => String(sql).includes('is_platform_admin'));
    expect(adminCalls).toHaveLength(0);
  });
});
