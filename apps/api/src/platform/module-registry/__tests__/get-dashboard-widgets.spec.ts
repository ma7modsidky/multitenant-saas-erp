import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TransactionManager } from '../../../core/database/transaction-manager.js';
import { GetDashboardWidgetsUseCase } from '../application/get-dashboard-widgets.use-case.js';
import { type ModuleRegistryRepository } from '../ports/index.js';

// REGISTERED_MODULES is mocked below with a stable fixture, so the module under
// test must never rely on the real catalog.
vi.mock('../registered-modules.js', () => ({
  REGISTERED_MODULES: [
    {
      key: 'crm',
      nameKey: 'modules.crm.name',
      icon: 'users',
      dashboardWidgets: [{ id: 'recent-deals', titleKey: 'modules.crm.widgets.recent_deals', width: 2, height: 1 }],
    },
    {
      key: 'inventory',
      nameKey: 'modules.inventory.name',
      icon: 'package',
      dashboardWidgets: [{ id: 'low-stock', titleKey: 'modules.inventory.widgets.low_stock', width: 2, height: 2 }],
    },
    {
      key: 'pos',
      nameKey: 'modules.pos.name',
      icon: 'credit-card',
      dashboardWidgets: [],
    },
  ],
}));

function createRepo(entitlements: Array<{ moduleKey: string; state: string }>): ModuleRegistryRepository {
  return {
    listEntitlements: vi.fn().mockResolvedValue(entitlements),
    getModule: vi.fn(),
    upsertModule: vi.fn(),
    listModules: vi.fn(),
    upsertPermission: vi.fn(),
    listPermissions: vi.fn(),
    pruneStaleModules: vi.fn(),
    getEntitlement: vi.fn(),
    getDependentModules: vi.fn(),
    updateEntitlementState: vi.fn(),
  };
}

describe('GetDashboardWidgetsUseCase', () => {
  let txManager: TransactionManager;
  let repo: ModuleRegistryRepository;
  let useCase: GetDashboardWidgetsUseCase;

  beforeEach(() => {
    txManager = { run: <T>(fn: () => Promise<T>) => fn() } as unknown as TransactionManager;
    repo = createRepo([]);
    useCase = new GetDashboardWidgetsUseCase(repo, txManager);
  });

  it('PLAN-3.3: returns widgets only for entitled modules with dashboardWidgets', async () => {
    repo = createRepo([
      { moduleKey: 'crm', state: 'active' },
      { moduleKey: 'inventory', state: 'trialing' },
      { moduleKey: 'pos', state: 'active' }, // pos has zero widgets → excluded
    ]);
    useCase = new GetDashboardWidgetsUseCase(repo, txManager);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.map((r) => r.moduleKey)).toEqual(['crm', 'inventory']);
    expect(result[0]!.widgets).toEqual([
      { id: 'recent-deals', titleKey: 'modules.crm.widgets.recent_deals', width: 2, height: 1, icon: 'users' },
    ]);
    expect(result[1]!.widgets[0]).toMatchObject({ id: 'low-stock', icon: 'package' });
  });

  it('PLAN-3.3: excludes modules in non-active states', async () => {
    repo = createRepo([
      { moduleKey: 'crm', state: 'disabled' },
      { moduleKey: 'inventory', state: 'suspended' },
    ]);
    useCase = new GetDashboardWidgetsUseCase(repo, txManager);

    const result = await useCase.execute({ organizationId: 'org-1' });
    expect(result).toEqual([]);
  });

  it('PLAN-3.3: returns an empty list when no entitlements exist', async () => {
    const result = await useCase.execute({ organizationId: 'org-1' });
    expect(result).toEqual([]);
  });

  it('PLAN-3.3: reads entitlements inside the tenant-bound transaction', async () => {
    const tx = { __tx: true };
    const run = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    txManager = { run } as unknown as TransactionManager;
    useCase = new GetDashboardWidgetsUseCase(repo, txManager);

    await useCase.execute({ organizationId: 'org-1' });

    expect(run).toHaveBeenCalledTimes(1);
    expect(repo.listEntitlements).toHaveBeenCalledWith('org-1', tx);
  });
});
