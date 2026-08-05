import { describe, expect, it, vi } from 'vitest';
import type { DrizzleDb } from '../../../../core/database/drizzle.provider.js';

import { CrmSearchContributor } from '../../search/crm-search.contributor.js';
import type { TransactionManager } from '../../../../core/database/transaction-manager.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const contactRow = { id: 'c-1', first_name: 'John', last_name: 'Doe', email: 'john@example.com' };
const companyRow = { id: 'co-1', name: 'Acme Inc', domain: 'acme.com' };
const dealRow = { id: 'd-1', title: 'Enterprise onboarding' };
const activityRow = { id: 'a-1', subject: 'Follow up on proposal' };

type EntityRows = {
  contacts?: (typeof contactRow)[];
  companies?: (typeof companyRow)[];
  deals?: (typeof dealRow)[];
  activities?: (typeof activityRow)[];
};

/**
 * Fake db.execute that answers the contributor's four queries IN CALL ORDER —
 * contacts, then companies, then deals, then activities (Promise.all invokes
 * the four search methods synchronously in that order). Each answer is capped
 * at the per-entity limit the contributor binds, mirroring the SQL LIMIT.
 */
function fakeDb(rows: EntityRows, perEntity: number) {
  return vi
    .fn()
    .mockImplementationOnce(async () => (rows.contacts ?? []).slice(0, perEntity))
    .mockImplementationOnce(async () => (rows.companies ?? []).slice(0, perEntity))
    .mockImplementationOnce(async () => (rows.deals ?? []).slice(0, perEntity))
    .mockImplementationOnce(async () => (rows.activities ?? []).slice(0, perEntity))
    .mockImplementation(async () => []);
}

function makeContributor(dbExecute: ReturnType<typeof fakeDb>) {
  // The contributor calls `db.execute(...)`, so the object handed through
  // runWithOrg must expose `execute` (not be the function itself).
  const fakeDbObject = { execute: dbExecute } as unknown as DrizzleDb;
  const tx = {
    runWithOrg: vi.fn(async (_orgId: string, fn: (db: unknown) => Promise<unknown>) => fn(fakeDbObject)),
  } as unknown as TransactionManager;
  return { contributor: new CrmSearchContributor(tx, fakeDbObject), tx };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CrmSearchContributor', () => {
  it('searches all four tenant tables inside the org-bound transaction', async () => {
    const dbExecute = fakeDb(
      { contacts: [contactRow], companies: [companyRow], deals: [dealRow], activities: [activityRow] },
      2,
    );
    const { contributor, tx } = makeContributor(dbExecute);

    const result = await contributor.search('acme', 'org-1', 8);

    expect(tx.runWithOrg).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(dbExecute).toHaveBeenCalledTimes(4);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      id: 'contact:c-1',
      title: 'John Doe',
      href: '/m/crm/contacts/c-1',
      icon: 'contact',
    });
    expect(result[1]).toMatchObject({
      id: 'company:co-1',
      title: 'Acme Inc',
      description: 'acme.com',
      href: '/m/crm/companies/co-1',
      icon: 'building',
    });
    expect(result[2]).toMatchObject({
      id: 'deal:d-1',
      title: 'Enterprise onboarding',
      href: '/m/crm/deals/d-1',
      icon: 'target',
    });
    expect(result[3]).toMatchObject({
      id: 'activity:a-1',
      title: 'Follow up on proposal',
      href: '/m/crm/activities/a-1',
      icon: 'activity',
    });
  });

  it('caps the aggregated results at the requested limit', async () => {
    const dbExecute = fakeDb(
      { contacts: [contactRow], companies: [companyRow], deals: [dealRow], activities: [activityRow] },
      1,
    );
    const { contributor } = makeContributor(dbExecute);

    const result = await contributor.search('acme', 'org-1', 2);

    // Every entity is still queried (parallel fan-out); only the combined
    // result is sliced to the limit.
    expect(dbExecute).toHaveBeenCalledTimes(4);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.href)).toEqual(['/m/crm/contacts/c-1', '/m/crm/companies/co-1']);
  });

  it('spreads the limit across entities (per-query limit = floor(limit / 4))', async () => {
    const dbExecute = fakeDb({ contacts: [contactRow, contactRow, contactRow], companies: [companyRow] }, 2);
    const { contributor } = makeContributor(dbExecute);

    // limit 8 → 2 per entity: contacts yield 2 of their 3 rows, companies 1.
    const result = await contributor.search('john', 'org-1', 8);
    expect(result).toHaveLength(3);
  });

  it('returns empty results without touching the database for short queries', async () => {
    const dbExecute = fakeDb({ contacts: [contactRow] }, 5);
    const { contributor, tx } = makeContributor(dbExecute);

    const result = await contributor.search('a', 'org-1', 5);
    expect(result).toEqual([]);
    expect(tx.runWithOrg).not.toHaveBeenCalled();
  });

  it('trims the query before searching', async () => {
    const dbExecute = fakeDb({ contacts: [contactRow] }, 5);
    const { contributor, tx } = makeContributor(dbExecute);

    const result = await contributor.search('  john  ', 'org-1', 5);
    expect(result).toHaveLength(1);
    expect(tx.runWithOrg).toHaveBeenCalledWith('org-1', expect.any(Function));
  });
});
